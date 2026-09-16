/**
 * Indicateurs anonymes — Questionnaire de recommandations vaccinales
 * MSP Route de Vienne
 *
 * Ce script n'enregistre AUCUNE donnée individuelle. Il incrémente des
 * compteurs mensuels : une ligne par mois, jamais une ligne par visite.
 * Aucun identifiant, aucun horodatage fin, aucun détail de situation
 * particulière ne lui parvient — voir le commentaire dans index.html.
 *
 * ── Installation ────────────────────────────────────────────────────────
 * 1. Créer un Google Sheet vierge (il servira de tableau de bord).
 * 2. Extensions → Apps Script, coller ce fichier, enregistrer.
 * 3. Déployer → Nouveau déploiement → type « Application web »
 *      · Exécuter en tant que : Moi
 *      · Qui a accès          : Tout le monde
 * 4. Copier l'URL /exec proposée.
 * 5. Dans index.html, renseigner :  const STATS_ENDPOINT = "…/exec";
 *
 * Après toute modification du script, il faut redéployer (Gérer les
 * déploiements → Modifier → Nouvelle version), sinon l'URL sert l'ancien code.
 */

/* ── Protection des écritures ────────────────────────────────────────────
 * L'adresse /exec est forcément publique : c'est le navigateur de chaque
 * visiteur qui l'appelle. Sans garde-fou, n'importe qui pourrait envoyer de
 * faux comptages et fausser le rapport d'activité.
 *
 * Deux barrières, volontairement modestes :
 *
 *  1. Une clé partagée, à recopier à l'identique dans index.html
 *     (const STATS_CLE). Elle écarte les robots et les appels au hasard.
 *     Elle ne cache rien à qui lit le code de la page : c'est un verrou de
 *     porte de jardin, pas un coffre - et il n'y a rien à voler ici, le
 *     script ne sait que compter.
 *
 *  2. Un plafond horaire. Même en connaissant la clé, on ne peut pas gonfler
 *     les compteurs plus vite que le comptoir ne reçoit de patients.
 *
 * Après modification de la clé : redéployer (Nouvelle version), sinon l'URL
 * continue de servir l'ancienne.
 */
var CLE = 'msp-84feb9a16b719652c1d0286d';
var PLAFOND_PAR_HEURE = 200;

var FEUILLE = 'Indicateurs';

var COLONNES = [
  'Mois',
  'Questionnaires commencés',
  'Questionnaires complétés',
  '11-24 ans',
  '25-44 ans',
  '45-64 ans',
  '65 ans et plus',
  'Total vaccins recommandés',
  'Impressions PDF'
];

var TRANCHES = {
  '11-24': '11-24 ans',
  '25-44': '25-44 ans',
  '45-64': '45-64 ans',
  '65+': '65 ans et plus'
};

function doPost(e) {
  // Lecture et contrôles d'abord : un appel douteux ne doit pas même
  // immobiliser le verrou que se partagent les vrais visiteurs.
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput('illisible');
  }

  if (data.k !== CLE) return ContentService.createTextOutput('refuse');
  if (plafondAtteint()) return ContentService.createTextOutput('plafond');

  var verrou = LockService.getScriptLock();
  // Deux patients peuvent finir en même temps : sans verrou, un incrément est perdu
  try {
    verrou.waitLock(20000);
  } catch (err) {
    return ContentService.createTextOutput('occupe');
  }

  try {
    var feuille = obtenirFeuille();
    var ligne = obtenirLigneDuMois(feuille);

    if (data.e === 'debut') {
      incrementer(feuille, ligne, 'Questionnaires commencés', 1);

    } else if (data.e === 'fin') {
      if (data.complet) {
        incrementer(feuille, ligne, 'Questionnaires complétés', 1);

        var colonneTranche = TRANCHES[data.tranche];
        if (colonneTranche) incrementer(feuille, ligne, colonneTranche, 1);

        var nb = Number(data.nb);
        if (nb > 0 && nb < 100) incrementer(feuille, ligne, 'Total vaccins recommandés', nb);
      }
    } else if (data.e === 'pdf') {
      incrementer(feuille, ligne, 'Impressions PDF', 1);
    }
  } catch (err) {
    console.error(err);
  } finally {
    verrou.releaseLock();
  }

  return ContentService.createTextOutput('ok');
}

/**
 * Compte les appels de l'heure en cours et dit si le plafond est franchi.
 *
 * Le compteur vit dans le cache du script, pas dans la feuille : il expire
 * tout seul et ne laisse aucune trace dans le classeur. Un appel perdu de
 * temps en temps (le cache n'est pas transactionnel) est sans conséquence
 * pour un garde-fou.
 */
function plafondAtteint() {
  var cache = CacheService.getScriptCache();
  var heure = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd-HH');
  var compte = Number(cache.get(heure) || 0) + 1;
  cache.put(heure, String(compte), 3900);  // un peu plus d'une heure
  return compte > PLAFOND_PAR_HEURE;
}

/** La feuille « Indicateurs », créée avec ses en-têtes au premier appel. */
function obtenirFeuille() {
  var classeur = SpreadsheetApp.getActiveSpreadsheet();
  var feuille = classeur.getSheetByName(FEUILLE);

  if (!feuille) {
    feuille = classeur.insertSheet(FEUILLE);
    feuille.getRange(1, 1, 1, COLONNES.length).setValues([COLONNES]).setFontWeight('bold');
    feuille.setFrozenRows(1);
  }
  return feuille;
}

/** La ligne du mois courant, créée à zéro si le mois vient de commencer. */
/**
 * Lit une cellule « Mois » quel que soit son type.
 *
 * Sheets convertit « 2026-09 » en date à l'écriture : comparer le texte brut
 * échouait toujours, et une ligne était créée à chaque envoi au lieu d'une
 * par mois.
 */
function cleMois(valeur) {
  if (valeur instanceof Date) {
    return Utilities.formatDate(valeur, 'Europe/Paris', 'yyyy-MM');
  }
  return String(valeur).trim().slice(0, 7);
}

function obtenirLigneDuMois(feuille) {
  var mois = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM');
  var dernier = feuille.getLastRow();

  if (dernier >= 2) {
    var moisConnus = feuille.getRange(2, 1, dernier - 1, 1).getValues();
    for (var i = 0; i < moisConnus.length; i++) {
      if (cleMois(moisConnus[i][0]) === mois) return i + 2;
    }
  }

  var ligne = dernier + 1;
  var vide = COLONNES.map(function () { return 0; });
  vide[0] = mois;
  // Colonne forcée en texte, sinon Sheets retransforme « 2026-09 » en date.
  feuille.getRange(ligne, 1).setNumberFormat('@');
  feuille.getRange(ligne, 1, 1, COLONNES.length).setValues([vide]);
  return ligne;
}

function incrementer(feuille, ligne, nomColonne, valeur) {
  var colonne = COLONNES.indexOf(nomColonne) + 1;
  if (colonne < 1) return;
  var cellule = feuille.getRange(ligne, colonne);
  cellule.setValue((Number(cellule.getValue()) || 0) + valeur);
}

/**
 * À lancer une fois depuis l'éditeur pour vérifier l'installation :
 * elle simule un questionnaire complet et doit créer la ligne du mois.
 */
function testerInstallation() {
  doPost({ postData: { contents: JSON.stringify({ e: 'debut' }) } });
  doPost({ postData: { contents: JSON.stringify(
    { e: 'fin', complet: 1, tranche: '45-64', nb: 4 }
  ) } });
  doPost({ postData: { contents: JSON.stringify({ e: 'pdf' }) } });
  installerTableauDeBord();
  Logger.log('Ligne du mois créée — vérifiez « Indicateurs » et « Tableau de bord ».');
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
    ['Part des 45 ans et plus',             "=IFERROR((SUM('" + src + "'!F2:F)+SUM('" + src + "'!G2:G))/B6,\"\")", '0.0%'],
    ['Bilans imprimés ou enregistrés en PDF', "=SUM('" + src + "'!I2:I)",            '0']
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

  f.getRange('A13').setValue('PAR MOIS').setFontWeight('bold').setFontColor('#1B7A8A');

  var entetes = ['Mois', 'Complétés', 'Taux de complétion', 'Moy. vaccins',
                 '45 ans et plus', 'PDF'];
  f.getRange(14, 1, 1, entetes.length).setValues([entetes])
   .setFontWeight('bold').setBackground('#eef4fb');

  var colonnes = [
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",'" + src + "'!A2:A))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",'" + src + "'!C2:C))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",IFERROR('" + src + "'!C2:C/'" + src + "'!B2:B,\"\")))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",IFERROR('" + src + "'!H2:H/'" + src + "'!C2:C,\"\")))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",IFERROR(('" + src + "'!F2:F+'" + src + "'!G2:G)/'" + src + "'!C2:C,\"\")))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",'" + src + "'!I2:I))"
  ];
  var formats = ['@', '0', '0.0%', '0.0', '0.0%', '0'];

  for (var c = 0; c < colonnes.length; c++) {
    f.getRange(15, c + 1).setFormula(adapter(colonnes[c], SEP));
    f.getRange(15, c + 1, 200, 1).setNumberFormat(formats[c]);
  }

  f.getRange('A' + (15 + 202))
   .setValue("Rappel : ne pas publier une case comptant moins de 5 personnes — "
           + "à cette échelle, un chiffre redevient identifiant. "
           + "Ces compteurs mesurent l'action de sensibilisation, pas les actes vaccinaux, "
           + "qui sont connus par la facturation.")
   .setFontColor('#A85D00').setFontSize(9).setWrap(true);

  f.setColumnWidth(1, 280);
  for (var w = 2; w <= 6; w++) f.setColumnWidth(w, 130);

  installerGraphiques(f, src);
  protegerCompteurs();
  return f;
}

/**
 * Les deux graphiques du tableau de bord.
 *
 * Choix de forme : des colonnes, jamais de camembert. Un secteur ne permet pas
 * de comparer des valeurs proches, or c'est exactement ce qu'on demande au
 * lecteur du rapport (« quelle tranche d'âge touche-t-on le plus ? »).
 *
 * Couleurs : #0E8FA8 et #EB6834, vérifiées pour rester distinguables en
 * vision des couleurs déficiente et suffisamment contrastées sur fond blanc.
 * Le bleu-vert de la charte, plus grisé, ne tenait pas ce rôle.
 */
function installerGraphiques(f, src) {
  var TEAL = '#0E8FA8';
  var ORANGE = '#EB6834';
  var ENCRE = '#52514E';
  var GRILLE = '#ECEFF1';

  f.getCharts().forEach(function (g) { f.removeChart(g); });

  var axeTexte = { color: ENCRE, fontSize: 10 };
  var titre = { color: '#14303D', fontSize: 13, bold: true };

  // ── Qui fait le point : une seule série, donc aucune légende ──
  var parAge = f.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(f.getRange('D5:E9'))
    .setPosition(4, 8, 0, 0)
    .setOption('title', 'Questionnaires complétés, par tranche d\'âge')
    .setOption('titleTextStyle', titre)
    .setOption('colors', [TEAL])
    .setOption('legend', { position: 'none' })
    .setOption('bar', { groupWidth: '52%' })
    .setOption('backgroundColor', '#FFFFFF')
    .setOption('width', 470)
    .setOption('height', 250)
    .setOption('chartArea', { left: 55, top: 50, width: '80%', height: '62%' })
    .setOption('hAxis', { textStyle: axeTexte })
    .setOption('vAxis', {
      textStyle: axeTexte,
      viewWindow: { min: 0 },
      gridlines: { color: GRILLE },
      minorGridlines: { count: 0 }
    })
    .build();
  f.insertChart(parAge);

  // ── Activité mois par mois : deux séries, donc légende obligatoire ──
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
  var feuille = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEUILLE);
  if (!feuille) return;

  feuille.getProtections(SpreadsheetApp.ProtectionType.SHEET)
         .forEach(function (p) { p.remove(); });

  feuille.protect()
         .setDescription('Compteurs alimentés par le questionnaire — ne pas modifier à la main')
         .setWarningOnly(true);
}
