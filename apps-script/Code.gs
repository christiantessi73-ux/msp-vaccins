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
  Logger.log('Ligne du mois créée — vérifiez la feuille « Indicateurs ».');
}
