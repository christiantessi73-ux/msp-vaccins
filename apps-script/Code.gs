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

var FEUILLE = 'Indicateurs';

var COLONNES = [
  'Mois',
  'Questionnaires commencés',
  'Questionnaires complétés',
  '11-24 ans',
  '25-44 ans',
  '45-64 ans',
  '65 ans et plus',
  'Avec situation particulière',
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
  var verrou = LockService.getScriptLock();
  // Deux patients peuvent finir en même temps : sans verrou, un incrément est perdu
  try {
    verrou.waitLock(20000);
  } catch (err) {
    return ContentService.createTextOutput('occupe');
  }

  try {
    var data = JSON.parse(e.postData.contents);
    var feuille = obtenirFeuille();
    var ligne = obtenirLigneDuMois(feuille);

    if (data.e === 'debut') {
      incrementer(feuille, ligne, 'Questionnaires commencés', 1);

    } else if (data.e === 'fin') {
      if (data.complet) {
        incrementer(feuille, ligne, 'Questionnaires complétés', 1);

        var colonneTranche = TRANCHES[data.tranche];
        if (colonneTranche) incrementer(feuille, ligne, colonneTranche, 1);

        if (data.sit) incrementer(feuille, ligne, 'Avec situation particulière', 1);

        var nb = Number(data.nb);
        if (nb > 0 && nb < 100) incrementer(feuille, ligne, 'Total vaccins recommandés', nb);
      }
      if (data.print) incrementer(feuille, ligne, 'Impressions PDF', 1);
    }
  } catch (err) {
    console.error(err);
  } finally {
    verrou.releaseLock();
  }

  return ContentService.createTextOutput('ok');
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
function obtenirLigneDuMois(feuille) {
  var mois = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM');
  var moisConnus = feuille.getRange(2, 1, Math.max(feuille.getLastRow() - 1, 1), 1).getValues();

  for (var i = 0; i < moisConnus.length; i++) {
    if (String(moisConnus[i][0]) === mois) return i + 2;
  }

  var ligne = feuille.getLastRow() + 1;
  var vide = COLONNES.map(function () { return 0; });
  vide[0] = mois;
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
    { e: 'fin', complet: 1, tranche: '45-64', nb: 4, sit: 1, print: 1 }
  ) } });
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

  f.getRange('A4').setValue('DEPUIS LE DÉBUT').setFontWeight('bold').setFontColor('#1B7A8A');

  var synthese = [
    ['Questionnaires commencés',            "=SUM('" + src + "'!B2:B)",              '0'],
    ['Questionnaires complétés',            "=SUM('" + src + "'!C2:C)",              '0'],
    ['Taux de complétion',                  "=IFERROR(B6/B5,\"\")",                  '0.0%'],
    ['Moyenne de vaccins par questionnaire', "=IFERROR(SUM('" + src + "'!I2:I)/B6,\"\")", '0.0'],
    ['Part des 45 ans et plus',             "=IFERROR((SUM('" + src + "'!F2:F)+SUM('" + src + "'!G2:G))/B6,\"\")", '0.0%'],
    ['Part déclarant une situation particulière', "=IFERROR(SUM('" + src + "'!H2:H)/B6,\"\")", '0.0%'],
    ['Bilans imprimés ou enregistrés en PDF', "=SUM('" + src + "'!J2:J)",            '0']
  ];

  for (var i = 0; i < synthese.length; i++) {
    var ligne = 5 + i;
    f.getRange(ligne, 1).setValue(synthese[i][0]);
    f.getRange(ligne, 2).setFormula(synthese[i][1]).setNumberFormat(synthese[i][2])
     .setFontWeight('bold').setHorizontalAlignment('right');
  }

  f.getRange('A13').setValue('PAR MOIS').setFontWeight('bold').setFontColor('#1B7A8A');

  var entetes = ['Mois', 'Complétés', 'Taux de complétion', 'Moy. vaccins',
                 '45 ans et plus', 'Situation particulière', 'PDF'];
  f.getRange(14, 1, 1, entetes.length).setValues([entetes])
   .setFontWeight('bold').setBackground('#eef4fb');

  var colonnes = [
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",'" + src + "'!A2:A))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",'" + src + "'!C2:C))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",IFERROR('" + src + "'!C2:C/'" + src + "'!B2:B,\"\")))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",IFERROR('" + src + "'!I2:I/'" + src + "'!C2:C,\"\")))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",IFERROR(('" + src + "'!F2:F+'" + src + "'!G2:G)/'" + src + "'!C2:C,\"\")))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",IFERROR('" + src + "'!H2:H/'" + src + "'!C2:C,\"\")))",
    "=ARRAYFORMULA(IF('" + src + "'!A2:A=\"\",\"\",'" + src + "'!J2:J))"
  ];
  var formats = ['@', '0', '0.0%', '0.0', '0.0%', '0.0%', '0'];

  for (var c = 0; c < colonnes.length; c++) {
    f.getRange(15, c + 1).setFormula(colonnes[c]);
    f.getRange(15, c + 1, 200, 1).setNumberFormat(formats[c]);
  }

  f.getRange('A' + (15 + 202))
   .setValue("Rappel : ne pas publier une case comptant moins de 5 personnes — "
           + "à cette échelle, un chiffre redevient identifiant. "
           + "Ces compteurs mesurent l'action de sensibilisation, pas les actes vaccinaux, "
           + "qui sont connus par la facturation.")
   .setFontColor('#A85D00').setFontSize(9).setWrap(true);

  f.setColumnWidth(1, 280);
  for (var w = 2; w <= 7; w++) f.setColumnWidth(w, 130);

  return f;
}
