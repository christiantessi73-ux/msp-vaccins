/**
 * Synchronisation des compteurs — MSP Route de Vienne
 *
 * Ce script ne compte plus rien. Les compteurs vivent désormais sur
 * l'hébergement OVH, alimentés par api.php : une seule source de vérité,
 * que les pages du site appellent sur leur propre domaine.
 *
 * Son rôle est de recopier ces compteurs dans le classeur, toutes les
 * heures. Les feuilles « Indicateurs » et « Actes » deviennent donc des
 * vues, réécrites intégralement à chaque passage — jamais saisies à la
 * main. C'est ce qui garantit que les deux endroits ne peuvent pas
 * diverger : l'un est calculé depuis l'autre.
 *
 * Le classeur y gagne le second rôle que la MSP cherchait au départ : une
 * copie hors-site des compteurs, avec l'historique de versions de Google
 * Sheets par-dessus.
 *
 * Installation
 * 1. Paramètres du projet → Propriétés du script, ajouter trois
 *    propriétés. Elles ne sont pas dans ce fichier, donc pas dans Git :
 *
 *      API      https://msp-vaccins.fr/api.php
 *      CLE      la valeur de 'cle' dans config.php
 *      LECTURE  la valeur de 'lecture' dans config.php
 *
 * 2. Lancer testerSynchronisation() une fois : elle vérifie l'accès,
 *    recopie les compteurs et installe le tableau de bord.
 * 3. Lancer installerSynchronisation() : elle pose le déclencheur horaire.
 *
 * Il n'y a plus de déploiement en application web. Ce script n'est appelé
 * par personne — c'est lui qui appelle. L'ancien déploiement /exec peut
 * être archivé : plus rien ne lui écrit.
 */

var FEUILLE = 'Indicateurs';
var FEUILLE_ACTES = 'Actes';

/* Le rapprochement mensuel vit dans sa propre feuille, écrite par la
 * synchronisation.
 *
 * Pourquoi pas une colonne de plus dans le tableau de bord : les deux
 * nombres viennent de feuilles différentes, et un graphique a besoin de
 * lignes réellement vides là où il n'y a pas de mois. Une ARRAYFORMULA
 * renvoie "" — du texte, pas du vide — et le graphique hérite de colonnes
 * fantômes. La synchronisation, elle, connaît les deux chiffres et n'écrit
 * que les mois qui existent.
 */
var FEUILLE_COMPARATIF = 'Rapprochement mensuel';

var COLONNES_COMPARATIF = [
  'Mois',
  'Restant à faire, d\'après les patients',
  'Doses administrées à la MSP'
];
var COLONNES = [
  'Mois',
  'Questionnaires commencés',
  'Questionnaires complétés',
  '11-24 ans',
  '25-44 ans',
  '45-64 ans',
  '65 ans et plus',
  'Total vaccins recommandés',
  'Vaccins déjà faits (déclarés)',
  'Vaccins à vérifier',
  'Vaccins restant à faire'
];

/* Les vaccins administrés, comptés dans leur propre feuille.
 *
 * Feuille distincte et non colonnes supplémentaires dans « Indicateurs » :
 * ce sont deux objets de mesure différents. « Indicateurs » compte des
 * questionnaires, « Actes » compte des injections. Les mélanger inviterait à
 * diviser l'un par l'autre, ce qu'aucun lien technique ne justifie.
 *
 * L'ordre reprend exactement celui de VACCINES dans index.html : les deux
 * listes doivent rester identiques, sinon un vaccin se compterait dans la
 * colonne d'un autre. */
var VACCINS = [
  'DTPc',
  'HPV (Papillomavirus Humain)',
  'Méningocoque',
  'ROR',
  'Hépatite B',
  'Hépatite A',
  'Varicelle',
  'Grippe',
  'Covid-19',
  'Pneumocoque',
  'Zona',
  'Coqueluche',
  'Bronchiolite / VRS',
  'Méningocoque ACWY',
  'Méningocoque B'
];

function colonnesActes() {
  return ['Mois'].concat(VACCINS).concat(['Total actes']);
}

/** Les trois propriétés de script, avec un message clair si l'une manque. */
function config() {
  var p = PropertiesService.getScriptProperties();
  var c = {
    api: p.getProperty('API'),
    cle: p.getProperty('CLE'),
    lecture: p.getProperty('LECTURE')
  };
  if (!c.api || !c.cle || !c.lecture) {
    throw new Error('Propriétés du script incomplètes : API, CLE et LECTURE '
                  + 'doivent être renseignées dans Paramètres du projet.');
  }
  return c;
}

/**
 * Va chercher les compteurs sur OVH.
 *
 * Lève plutôt que de renvoyer un document vide : un appel raté ne doit
 * surtout pas être confondu avec « il n'y a rien à compter », sans quoi la
 * synchronisation viderait le classeur à la première coupure réseau.
 */
function lireCompteurs() {
  var c = config();

  var reponse = UrlFetchApp.fetch(c.api, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ e: 'lire', k: c.cle, secret: c.lecture }),
    muteHttpExceptions: true
  });

  var code = reponse.getResponseCode();
  var texte = reponse.getContentText();

  if (code !== 200) {
    throw new Error('api.php a répondu ' + code + ' : ' + texte.slice(0, 200));
  }

  var etat;
  try {
    etat = JSON.parse(texte);
  } catch (err) {
    // Une réponse non-JSON est un jeton de refus (code-refuse, plafond…).
    // Le citer tel quel évite de chercher une panne là où il n'y a qu'un
    // secret mal recopié.
    throw new Error('Réponse inattendue de api.php : ' + texte.slice(0, 120));
  }

  if (!etat || typeof etat.indicateurs !== 'object' || typeof etat.actes !== 'object') {
    throw new Error('Document de compteurs incomplet — synchronisation annulée.');
  }

  return etat;
}

/** Les mois présents, du plus ancien au plus récent. */
function moisTries(objet) {
  return Object.keys(objet || {}).filter(function (m) {
    return /^[0-9]{4}-[0-9]{2}$/.test(m);
  }).sort();
}

/**
 * Réécrit une feuille de A1 au coin bas-droit.
 *
 * On efface avant d'écrire : un mois qui disparaîtrait de la source ne doit
 * pas survivre dans le classeur, sinon la vue cesserait d'être une vue.
 */
function reecrire(nom, colonnes, lignes) {
  var classeur = SpreadsheetApp.getActiveSpreadsheet();
  var f = classeur.getSheetByName(nom) || classeur.insertSheet(nom);

  f.clearContents();
  f.getRange(1, 1, 1, colonnes.length).setValues([colonnes]).setFontWeight('bold');
  f.setFrozenRows(1);

  if (lignes.length > 0) {
    // Colonne des mois en texte, sinon Sheets retransforme « 2026-09 » en date.
    f.getRange(2, 1, lignes.length, 1).setNumberFormat('@');
    f.getRange(2, 1, lignes.length, colonnes.length).setValues(lignes);
  }
  return f;
}

/**
 * Le travail principal, appelé par le déclencheur horaire.
 *
 * Tout se joue dans l'ordre : on lit d'abord, on n'écrit qu'ensuite. Si la
 * lecture échoue, lireCompteurs() lève et le classeur n'est pas touché — il
 * garde les chiffres de la dernière synchronisation réussie, ce qui vaut
 * infiniment mieux qu'un tableau de bord vidé par une coupure passagère.
 */
function synchroniser() {
  var etat = lireCompteurs();

  var lignesInd = moisTries(etat.indicateurs).map(function (m) {
    var l = etat.indicateurs[m] || {};
    var n = function (k) { return Number(l[k]) || 0; };
    return [m, n('commences'), n('completes'), n('11-24'), n('25-44'),
            n('45-64'), n('65+'), n('recommandes'),
            n('faits'), n('verif'), n('restants')];
  });

  var lignesActes = moisTries(etat.actes).map(function (m) {
    var doses = etat.actes[m] || {};
    var total = 0;
    var ligne = [m];
    VACCINS.forEach(function (nom) {
      var v = Number(doses[nom]) || 0;
      ligne.push(v);
      total += v;
    });
    ligne.push(total);
    return ligne;
  });

  /* Les deux séries du rapprochement, mois par mois.
   *
   * Elles se lisent côte à côte et ne se divisent jamais l'une par l'autre :
   * une dose administrée au comptoir n'a pas forcément suivi un
   * questionnaire, et rien dans le dispositif ne permet de le savoir. Les
   * mois sont ceux du questionnaire : un mois sans questionnaire n'a pas de
   * besoin détecté à comparer. */
  var dosesParMois = {};
  moisTries(etat.actes).forEach(function (m) {
    var d = etat.actes[m] || {};
    var total = 0;
    VACCINS.forEach(function (nom) { total += Number(d[nom]) || 0; });
    dosesParMois[m] = total;
  });

  var lignesComp = moisTries(etat.indicateurs).map(function (m) {
    var l = etat.indicateurs[m] || {};
    return [m, Number(l.restants) || 0, dosesParMois[m] || 0];
  });

  reecrire(FEUILLE, COLONNES, lignesInd);
  reecrire(FEUILLE_ACTES, colonnesActes(), lignesActes);
  reecrire(FEUILLE_COMPARATIF, COLONNES_COMPARATIF, lignesComp);

  // L'horodatage rend une panne visible. Sans lui, une synchronisation
  // arrêtée laisse un tableau de bord parfaitement crédible et périmé.
  PropertiesService.getScriptProperties()
    .setProperty('DERNIERE_SYNCHRO',
      Utilities.formatDate(new Date(), 'Europe/Paris', "dd/MM/yyyy 'à' HH:mm"));

  marquerSynchro();
  protegerCompteurs();

  return lignesInd.length + ' mois de compteurs, '
       + lignesActes.length + ' mois de doses.';
}

/** Reporte l'horodatage sur le tableau de bord, s'il existe. */
function marquerSynchro() {
  var f = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tableau de bord');
  if (!f) return;
  var quand = PropertiesService.getScriptProperties().getProperty('DERNIERE_SYNCHRO');
  f.getRange('A3').setValue('Compteurs relevés le ' + (quand || '—')
                          + ' — source : msp-vaccins.fr')
   .setFontColor('#666666').setFontSize(9);
}

/** Pose le déclencheur horaire, en remplaçant l'ancien s'il existe. */
function installerSynchronisation() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'synchroniser') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('synchroniser').timeBased().everyHours(1).create();
  Logger.log('Déclencheur posé : synchronisation toutes les heures.');
}

/** À lancer une fois, après avoir renseigné les propriétés du script. */
function testerSynchronisation() {
  var resume = synchroniser();
  installerTableauDeBord();
  marquerSynchro();
  Logger.log('Synchronisation réussie — ' + resume
           + ' Vérifiez « Indicateurs », « Actes » et « Tableau de bord », '
           + 'puis lancez installerSynchronisation().');
}

/**
 * Crée (ou recrée) la feuille « Tableau de bord ».
 *
 * C'est cette feuille que les médecins consultent : elle ne contient que des
 * formules qui lisent « Indicateurs », donc elle reste à jour toute seule et
 * aucune saisie n'y est nécessaire. Les compteurs bruts restent à côté.
 *
 * À lancer une fois depuis l'éditeur, puis à chaque fois qu'on veut la remettre
 * à neuf.
 */
/**
 * Le séparateur d'arguments des formules dépend de la langue du classeur :
 * virgule en anglais, point-virgule en français. On le mesure au lieu de le
 * supposer : une formule test dans une cellule hors zone, puis on regarde si
 * elle a été comprise.
 */
function separateurArguments(f) {
  var sonde = f.getRange(1, 26);
  sonde.setFormula('=IFERROR(1,2)');
  var virguleComprise = (sonde.getValue() === 1);
  sonde.clearContent();
  return virguleComprise ? ',' : ';';
}

/** Aucune de nos formules ne contient de virgule dans un texte : la
    substitution est donc sans risque. */
function adapter(formule, sep) {
  return sep === ',' ? formule : formule.split(',').join(sep);
}

function installerTableauDeBord() {
  var classeur = SpreadsheetApp.getActiveSpreadsheet();
  var ancienne = classeur.getSheetByName('Tableau de bord');
  if (ancienne) classeur.deleteSheet(ancienne);

  var f = classeur.insertSheet('Tableau de bord', 0);
  var src = FEUILLE;
  var ACTES = FEUILLE_ACTES;

  // Les deux feuilles de compteurs doivent exister avant que les formules ne
  // les citent : sinon le tableau s'installe plein de #REF!. La
  // synchronisation les crée si besoin, alors on la laisse faire.
  if (!classeur.getSheetByName(src) || !classeur.getSheetByName(ACTES)
      || !classeur.getSheetByName(FEUILLE_COMPARATIF)) {
    synchroniser();
  }

  f.getRange('A1').setValue('Recommandations vaccinales — activité de prévention')
   .setFontSize(14).setFontWeight('bold');
  f.getRange('A2').setValue('MSP Route de Vienne · chiffres agrégés, mis à jour automatiquement')
   .setFontColor('#666666');

  var SEP = separateurArguments(f);

  f.getRange('A4').setValue('DEPUIS LE DÉBUT').setFontWeight('bold').setFontColor('#1B7A8A');

  var synthese = [
    ['Questionnaires commencés',            "=SUM('" + src + "'!B2:B)",              '0'],
    ['Questionnaires complétés',            "=SUM('" + src + "'!C2:C)",              '0'],
    ['Taux de complétion',                  "=IFERROR(B6/B5,\"\")",                  '0.0%'],
    ['Moyenne de vaccins par questionnaire', "=IFERROR(SUM('" + src + "'!H2:H)/B6,\"\")", '0.0'],
    ['Couverture déclarée (vaccins déjà faits)', "=IFERROR(SUM('" + src + "'!I2:I)/SUM('" + src + "'!H2:H),\"\")", '0.0%'],
    ['Doses administrées à la MSP',          "=IFERROR(SUM('" + ACTES + "'!Q2:Q),0)",  '0']
  ];

  for (var i = 0; i < synthese.length; i++) {
    var ligne = 5 + i;
    f.getRange(ligne, 1).setValue(synthese[i][0]);
    f.getRange(ligne, 2).setFormula(adapter(synthese[i][1], SEP)).setNumberFormat(synthese[i][2])
     .setFontWeight('bold').setHorizontalAlignment('right');
  }

  // Répartition par âge : alimente le graphique, et se lit telle quelle
  f.getRange('D4').setValue('RÉPARTITION PAR ÂGE')
   .setFontWeight('bold').setFontColor('#1B7A8A');

  var tranches = [
    ['11-24 ans',      "=SUM('" + src + "'!D2:D)"],
    ['25-44 ans',      "=SUM('" + src + "'!E2:E)"],
    ['45-64 ans',      "=SUM('" + src + "'!F2:F)"],
    ['65 ans et plus', "=SUM('" + src + "'!G2:G)"]
  ];

  // En-tetes explicites : sans eux, le graphique peut prendre la premiere
  // ligne de donnees pour un nom de serie.
  f.getRange(5, 4, 1, 2).setValues([["Tranche d'âge", 'Complétés']])
   .setFontWeight('bold').setBackground('#eef4fb');

  for (var t = 0; t < tranches.length; t++) {
    f.getRange(6 + t, 4).setValue(tranches[t][0]);
    f.getRange(6 + t, 5).setFormula(adapter(tranches[t][1], SEP))
     .setNumberFormat('0').setHorizontalAlignment('right');
  }

  /* Vaccins administrés
     Ces doses viennent de acte.html, saisies par l'équipe. Elles ne se
     divisent par rien de ce qui précède : un vaccin fait au comptoir n'a pas
     forcément suivi un questionnaire, et rien dans le dispositif ne permet
     de le savoir. Deux mesures côte à côte, jamais un rapport entre elles. */
  f.getRange('A14').setValue('VACCINS ADMINISTRÉS À LA MSP')
   .setFontWeight('bold').setFontColor('#1B7A8A');

  f.getRange(15, 1, 1, 2).setValues([['Vaccin', 'Doses']])
   .setFontWeight('bold').setBackground('#eef4fb');

  for (var v = 0; v < VACCINS.length; v++) {
    // Colonnes B à P de la feuille « Actes », dans l'ordre de VACCINS.
    var lettre = String.fromCharCode(66 + v);
    f.getRange(16 + v, 1).setValue(VACCINS[v]);
    f.getRange(16 + v, 2)
     .setFormula(adapter("=IFERROR(SUM('" + ACTES + "'!" + lettre + "2:" + lettre + "),0)", SEP))
     .setNumberFormat('0').setHorizontalAlignment('right');
  }

  var ligneTotal = 16 + VACCINS.length;
  f.getRange(ligneTotal, 1).setValue('Total des doses').setFontWeight('bold');
  f.getRange(ligneTotal, 2)
   .setFormula(adapter("=IFERROR(SUM('" + ACTES + "'!Q2:Q),0)", SEP))
   .setNumberFormat('0').setFontWeight('bold').setHorizontalAlignment('right');

  var DEB = ligneTotal + 3;   // première ligne du bloc mensuel

  f.getRange('A' + DEB).setValue('PAR MOIS').setFontWeight('bold').setFontColor('#1B7A8A');

  var entetes = ['Mois', 'Complétés', 'Taux de complétion', 'Moy. vaccins',
                 '45 ans et plus', 'Couverture déclarée'];
  f.getRange(DEB + 1, 1, 1, entetes.length).setValues([entetes])
   .setFontWeight('bold').setBackground('#eef4fb');

  var colonnes = [
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",'" + src + "'!A2:A))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",'" + src + "'!C2:C))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",IFERROR('" + src + "'!C2:C/'" + src + "'!B2:B,\"\")))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",IFERROR('" + src + "'!H2:H/'" + src + "'!C2:C,\"\")))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",IFERROR(('" + src + "'!F2:F+'" + src + "'!G2:G)/'" + src + "'!C2:C,\"\")))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",IFERROR('" + src + "'!I2:I/'" + src + "'!H2:H,\"\")))"
  ];
  var formats = ['@', '0', '0.0%', '0.0', '0.0%', '0.0%'];

  for (var c = 0; c < colonnes.length; c++) {
    f.getRange(DEB + 2, c + 1).setFormula(adapter(colonnes[c], SEP));
    f.getRange(DEB + 2, c + 1, 200, 1).setNumberFormat(formats[c]);
  }

  f.getRange('A' + (DEB + 204))
   .setValue("Rappel : ne pas publier une case comptant moins de 5 personnes — "
           + "à cette échelle, un chiffre redevient identifiant. "
           + "« Couverture déclarée » est ce que les patients disent avoir fait, "
           + "pas un relevé de carnet. « Vaccins administrés » est saisi à la main "
           + "par l'équipe : c'est un plancher, jamais un total — le compte exact "
           + "sort de la facturation. Ces deux blocs se lisent côte à côte et ne se "
           + "divisent pas l'un par l'autre : rien ne relie une dose à un questionnaire. "
           + "Le graphique qui les rapproche les met côte à côte sur un même mois, "
           + "il n'attribue pas les doses au questionnaire.")
   .setFontColor('#A85D00').setFontSize(9).setWrap(true);

  f.setColumnWidth(1, 280);
  for (var w = 2; w <= 7; w++) f.setColumnWidth(w, 130);

  installerGraphiques(f, src, ligneTotal, DEB);

  protegerCompteurs();
  return f;
}

/**
 * Les deux graphiques du tableau de bord.
 *
 * Des colonnes partout, sauf pour la répartition par âge, où la MSP a demandé
 * un camembert.
 *
 * La réserve reste vraie : un secteur ne permet pas de comparer deux valeurs
 * proches, et la question posée au lecteur du rapport en est une (« quelle
 * tranche touche-t-on le plus ? »). Elle est levée autrement, en inscrivant
 * le pourcentage sur chaque part : la comparaison se lit alors sur les
 * chiffres, plus sur la surface des secteurs.
 *
 * Couleurs : #0E8FA8 et #EB6834, vérifiées pour rester distinguables en
 * vision des couleurs déficiente et suffisamment contrastées sur fond blanc.
 * Le bleu-vert de la charte, plus grisé, ne tenait pas ce rôle.
 */
function installerGraphiques(f, src, ligneTotalActes, debutMensuel) {
  var TEAL = '#0E8FA8';
  var ORANGE = '#EB6834';
  var ENCRE = '#52514E';
  var GRILLE = '#ECEFF1';

  f.getCharts().forEach(function (g) { f.removeChart(g); });

  var axeTexte = { color: ENCRE, fontSize: 10 };
  var titre = { color: '#14303D', fontSize: 13, bold: true };

  /* Qui fait le point : quatre parts, donc une légende - une étiquette ne
     tient pas dans un secteur étroit, et c'est justement celui qu'on cherche
     à lire. Le pourcentage, lui, est inscrit sur la part. Quatre teintes
     distinctes, vérifiées pour rester différenciables en vision des couleurs
     déficiente. */
  var parAge = f.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(f.getRange('D5:E9'))
    .setPosition(4, 8, 0, 0)
    .setOption('title', 'Questionnaires completés, par tranche d’âge')
    .setOption('titleTextStyle', titre)
    .setOption('colors', [TEAL, '#4F72B7', ORANGE, '#7A5195'])
    .setOption('legend', { position: 'right', textStyle: axeTexte })
    .setOption('pieSliceText', 'percentage')
    .setOption('pieSliceTextStyle', { color: '#FFFFFF', fontSize: 11, bold: true })
    .setOption('pieSliceBorderColor', '#FFFFFF')
    .setOption('backgroundColor', '#FFFFFF')
    .setOption('width', 470)
    .setOption('height', 270)
    .setOption('chartArea', { left: 10, top: 50, width: '92%', height: '78%' })
    .build();
  f.insertChart(parAge);

  // Activité mois par mois : deux séries, donc légende obligatoire
  // La source est « Indicateurs » et non le tableau du dessous : ses lignes
  // vides le sont réellement, là où les formules du tableau renvoient "",
  // ce qui créerait des colonnes fantômes.
  var brut = f.getParent().getSheetByName(src);

  var parMois = f.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(brut.getRange('A1:C200'))
    .setPosition(18, 8, 0, 0)
    .setOption('title', 'Activité mois par mois')
    .setOption('titleTextStyle', titre)
    .setOption('series', {
      0: { color: TEAL, labelInLegend: 'Commencés' },
      1: { color: ORANGE, labelInLegend: 'Complétés' }
    })
    .setOption('legend', { position: 'top', alignment: 'start', textStyle: axeTexte })
    .setOption('bar', { groupWidth: '58%' })
    .setOption('backgroundColor', '#FFFFFF')
    .setOption('width', 620)
    .setOption('height', 300)
    .setOption('chartArea', { left: 55, top: 60, width: '84%', height: '62%' })
    .setOption('hAxis', { textStyle: axeTexte })
    .setOption('vAxis', {
      textStyle: axeTexte,
      viewWindow: { min: 0 },
      gridlines: { color: GRILLE },
      minorGridlines: { count: 0 }
    })
    .build();
  f.insertChart(parMois);

  // Doses administrées : une seule série, barres horizontales
  // Quinze libellés de vaccins ne tiennent pas en abscisse sans se chevaucher
  // ou basculer à 45° ; en barres, ils se lisent à l'horizontale.
  var parVaccin = f.newChart()
    .setChartType(Charts.ChartType.BAR)
    .addRange(f.getRange(15, 1, ligneTotalActes - 15, 2))
    .setPosition(debutMensuel, 8, 0, 0)
    .setOption('title', 'Doses administrées à la MSP, par vaccin')
    .setOption('titleTextStyle', titre)
    .setOption('colors', [ORANGE])
    .setOption('legend', { position: 'none' })
    .setOption('backgroundColor', '#FFFFFF')
    .setOption('width', 620)
    .setOption('height', 420)
    .setOption('chartArea', { left: 170, top: 50, width: '62%', height: '86%' })
    .setOption('hAxis', {
      textStyle: axeTexte,
      viewWindow: { min: 0 },
      gridlines: { color: GRILLE },
      minorGridlines: { count: 0 }
    })
    .setOption('vAxis', { textStyle: axeTexte })
    .build();
  f.insertChart(parVaccin);

  /* Besoin détecté et doses administrées, mois par mois
     Deux séries côte à côte, jamais empilées : empiler additionnerait des
     choses qui ne s'additionnent pas, et suggérerait que les doses sortent
     du besoin détecté. Rien ne relie les deux.

     La source est la feuille du rapprochement, écrite en valeurs par la
     synchronisation : ses lignes vides le sont réellement, là où une
     formule renverrait "" et produirait des colonnes fantômes. */
  var comp = f.getParent().getSheetByName(FEUILLE_COMPARATIF);
  if (comp) {
    var parMoisCompare = f.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(comp.getRange('A1:C200'))
      .setPosition(debutMensuel + 22, 8, 0, 0)
      .setOption('title', 'Besoin détecté et doses administrées, par mois')
      .setOption('titleTextStyle', titre)
      .setOption('series', {
        0: { color: TEAL, labelInLegend: 'Restant à faire, d\'après les patients' },
        1: { color: ORANGE, labelInLegend: 'Doses administrées à la MSP' }
      })
      .setOption('legend', { position: 'top', alignment: 'start', textStyle: axeTexte })
      .setOption('bar', { groupWidth: '58%' })
      .setOption('backgroundColor', '#FFFFFF')
      .setOption('width', 620)
      .setOption('height', 320)
      .setOption('chartArea', { left: 55, top: 70, width: '84%', height: '58%' })
      .setOption('hAxis', { textStyle: axeTexte })
      .setOption('vAxis', {
        textStyle: axeTexte,
        viewWindow: { min: 0 },
        gridlines: { color: GRILLE },
        minorGridlines: { count: 0 }
      })
      .build();
    f.insertChart(parMoisCompare);
  }
}

/**
 * Garde-fou sur la feuille « Indicateurs ».
 *
 * Le classeur est partagé au-delà de la MSP : une saisie manuelle dans les
 * compteurs les fausserait sans qu'aucune sauvegarde permette de les
 * reconstituer. En mode avertissement, le script continue d'écrire librement
 * et un humain reçoit une demande de confirmation.
 */
function protegerCompteurs() {
  var classeur = SpreadsheetApp.getActiveSpreadsheet();

  [FEUILLE, FEUILLE_ACTES, FEUILLE_COMPARATIF].forEach(function (nom) {
    var feuille = classeur.getSheetByName(nom);
    if (!feuille) return;

    feuille.getProtections(SpreadsheetApp.ProtectionType.SHEET)
           .forEach(function (p) { p.remove(); });

    feuille.protect()
           .setDescription('Compteurs alimentés par le site — ne pas modifier à la main')
           .setWarningOnly(true);
  });
}
