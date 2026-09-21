<?php
/**
 * Compteurs anonymes — MSP Route de Vienne
 *
 * Reprend le rôle que tenait Apps Script : recevoir les événements du
 * questionnaire et de la saisie des doses, et incrémenter des compteurs
 * mensuels. Aucune donnée individuelle ne lui parvient, et il n'existe
 * nulle part de ligne « un patient ».
 *
 * ── Pourquoi ici plutôt que chez Google ────────────────────────────────
 * Une seule source de vérité. Le Google Sheet devient une vue, réécrite
 * depuis ce fichier, jamais saisie à la main : deux chiffres ne peuvent pas
 * diverger quand l'un est calculé depuis l'autre.
 *
 * Accessoirement, les pages appellent désormais leur propre domaine : plus
 * de requête inter-origine ni de redirection vers googleusercontent.com.
 *
 * ── Où vivent les données ──────────────────────────────────────────────
 * Dans DOSSIER, AU-DESSUS de la racine web. Ce n'est pas un détail :
 *
 *   · le miroir de déploiement ne touche que « www/ », donc son --delete
 *     n'efface pas les compteurs à chaque publication ;
 *   · rien de ce qui s'y trouve n'est téléchargeable par un visiteur.
 *
 * Un fichier de compteurs rangé dans « www/ » serait détruit à la première
 * mise à jour. C'est exactement ce qu'on cherche à éviter.
 *
 * ── La configuration n'est pas dans ce dépôt ───────────────────────────
 * La clé partagée et le code de l'équipe vivent dans config.php, à créer
 * une fois à la main à côté des données. Voir CONFIG_EXEMPLE plus bas.
 * C'est un gain par rapport à Apps Script, où la clé était forcément
 * versionnée avec le reste.
 */

const DOSSIER  = '/home/mspvacu/donnees-msp';
const COMPTEUR = DOSSIER . '/compteurs.json';
const CONFIG   = DOSSIER . '/config.php';

/* Même garde-fou que précédemment : au-delà, on n'est plus dans la
   fréquentation d'un comptoir. Il borne aussi les tentatives de code, ce
   qui rend une recherche exhaustive impraticable. */
const PLAFOND_PAR_HEURE = 200;

/* Bornes de cohérence. Un paquet bricolé ne doit pas pouvoir fausser une
   colonne : ce qui dépasse est écrêté, jamais refusé en silence. */
const MAX_VACCINS_PAR_QUESTIONNAIRE = 100;
const MAX_DOSES_PAR_SAISIE = 50;

const TRANCHES = ['11-24', '25-44', '45-64', '65+'];

/* Même liste et même ordre que VACCINES dans index.html, VACCINS dans
   acte.html et la feuille « Actes ». Les quatre doivent rester identiques :
   un nom qui diverge se compterait dans la colonne d'un autre. */
const VACCINS = [
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
    'Méningocoque B',
];

/*
 * CONFIG_EXEMPLE — à déposer en /home/mspvacu/donnees-msp/config.php
 *
 *   <?php
 *   return [
 *       'cle'     => '…',   // identique à STATS_CLE dans les deux pages
 *       'pin'     => '…',   // le code du comptoir, saisi sur acte.html
 *       'lecture' => '…',   // pour le script de synchronisation
 *   ];
 *
 * Aucune valeur réelle ici : ce fichier est versionné, config.php ne l'est
 * pas, et c'est toute la raison d'être de la séparation.
 */

function repondre(string $jeton): never
{
    header('Content-Type: text/plain; charset=utf-8');
    // Ces compteurs ne se mettent jamais en cache : une réponse rejouée
    // ferait croire à un enregistrement qui n'a pas eu lieu.
    header('Cache-Control: no-store');
    echo $jeton;
    exit;
}

function mois(): string
{
    // Le serveur date, jamais le navigateur : c'est ce qui permet de ne
    // transmettre aucun horodatage depuis la page.
    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Paris')))->format('Y-m');
}

function ligneIndicateurs(): array
{
    return [
        'commences'   => 0,
        'completes'   => 0,
        '11-24'       => 0,
        '25-44'       => 0,
        '45-64'       => 0,
        '65+'         => 0,
        'recommandes' => 0,
        'pdf'         => 0,
        'faits'       => 0,
        'verif'       => 0,
        'restants'    => 0,
    ];
}

/** Une part d'un total, bornée par ce total. */
function ventiler(array &$ligne, string $champ, mixed $part, int $total): void
{
    $n = (int) $part;
    if ($n > 0 && $total > 0) {
        $ligne[$champ] += min($n, $total);
    }
}

/**
 * Nettoie un état reçu de l'extérieur avant de l'écrire.
 *
 * Un import remplace tout : c'est la seule opération du fichier qui puisse
 * détruire des compteurs. Elle ne recopie donc jamais ce qu'on lui donne —
 * elle reconstruit un document à partir des seuls champs connus, en
 * n'acceptant que des mois bien formés et des entiers positifs. Ce qui ne
 * rentre pas dans ce moule est écarté sans bruit.
 */
function assainir(array $recu): array
{
    $propre = ['version' => 1, 'indicateurs' => [], 'actes' => []];
    $modele = ligneIndicateurs();

    foreach (($recu['indicateurs'] ?? []) as $mois => $ligne) {
        if (!is_string($mois) || !preg_match('/^\d{4}-\d{2}$/', $mois) || !is_array($ligne)) {
            continue;
        }
        $propre['indicateurs'][$mois] = $modele;
        foreach ($modele as $champ => $_) {
            $v = (int) ($ligne[$champ] ?? 0);
            $propre['indicateurs'][$mois][$champ] = max(0, $v);
        }
    }

    foreach (($recu['actes'] ?? []) as $mois => $doses) {
        if (!is_string($mois) || !preg_match('/^\d{4}-\d{2}$/', $mois) || !is_array($doses)) {
            continue;
        }
        $propre['actes'][$mois] = [];
        foreach (VACCINS as $nom) {
            $v = max(0, (int) ($doses[$nom] ?? 0));
            if ($v > 0) {
                $propre['actes'][$mois][$nom] = $v;
            }
        }
    }

    ksort($propre['indicateurs']);
    ksort($propre['actes']);

    return $propre;
}

// ── Contrôles avant toute ouverture de fichier ───────────────────────────

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    repondre('methode');
}

if (!is_file(CONFIG)) {
    // Sans configuration, on ne compte rien plutôt que de compter faux. Le
    // jeton est explicite : c'est une installation incomplète, pas un refus.
    http_response_code(503);
    repondre('config-absente');
}
$config = require CONFIG;

$brut = file_get_contents('php://input');
// 8 Ko suffisent très largement à un événement ordinaire ; un import porte
// plusieurs années de compteurs, d'où la limite plus haute.
if ($brut === false || strlen($brut) > 262144) {
    repondre('illisible');
}

$data = json_decode($brut, true);
if (!is_array($data)) {
    repondre('illisible');
}

if (!isset($data['k']) || !hash_equals((string) $config['cle'], (string) $data['k'])) {
    repondre('refuse');
}

$evenement = isset($data['e']) ? (string) $data['e'] : '';

// Le code de l'équipe garde un traitement à part : sa vérification doit
// répondre franchement, et surtout pas « ok », qui ouvrirait la page de
// saisie à n'importe quoi.
$codeFourni = isset($data['pin']) ? (string) $data['pin'] : '';
$codeValide = $codeFourni !== '' && hash_equals((string) $config['pin'], $codeFourni);

/* Trois secrets, trois usages, et c'est délibéré :
 *
 *   'pin'     le code du comptoir. Il circule entre les mains de l'équipe,
 *             donc il ouvre la saisie et la consultation, rien d'autre.
 *   'lecture' réservé au script de synchronisation, qui recopie les
 *             compteurs dans le classeur. Lui confier le code du comptoir
 *             reviendrait à le graver dans un script qu'on oublie.
 *   'admin'   le remplacement complet des compteurs, le temps d'une
 *             migration. Absent de config.php, l'import n'existe pas.
 *
 * Qui peut tout remplacer peut évidemment tout lire : 'admin' vaut aussi
 * pour la lecture, ce qui évite un quatrième secret. L'inverse est faux.
 */
$secretLecture = isset($config['lecture']) ? (string) $config['lecture'] : '';
$secretAdmin   = isset($config['admin']) ? (string) $config['admin'] : '';
$fourni        = isset($data['secret']) ? (string) $data['secret'] : '';

$peutLire = $codeValide
    || ($secretLecture !== '' && $fourni !== '' && hash_equals($secretLecture, $fourni))
    || ($secretAdmin !== '' && $fourni !== '' && hash_equals($secretAdmin, $fourni));

if (in_array($evenement, ['acte', 'code'], true) && !$codeValide) {
    repondre('code-refuse');
}
if ($evenement === 'lire' && !$peutLire) {
    repondre('code-refuse');
}

/* L'import remplace la totalité des compteurs : c'est la seule opération
 * destructrice du fichier. Elle exige donc un secret distinct du code de
 * l'équipe — celui-ci circule au comptoir, il n'a pas à pouvoir effacer un
 * trimestre de relevés.
 *
 * Absent de config.php, l'import n'existe pas. C'est l'état par défaut, et
 * le bon : on ne l'active que le temps d'une migration. */
if ($evenement === 'import') {
    if ($secretAdmin === '') {
        repondre('import-desactive');
    }
    $admin = isset($data['admin']) ? (string) $data['admin'] : '';
    if ($admin === '' || !hash_equals($secretAdmin, $admin)) {
        repondre('admin-refuse');
    }
}

// ── Lecture, modification, écriture, sous verrou ─────────────────────────

if (!is_dir(DOSSIER) && !@mkdir(DOSSIER, 0700, true)) {
    http_response_code(500);
    repondre('stockage');
}

$fp = @fopen(COMPTEUR, 'c+');
if ($fp === false) {
    http_response_code(500);
    repondre('stockage');
}

/* Verrou exclusif sur toute la séquence lire-modifier-écrire. Sans lui,
   deux patients qui terminent à la même seconde se liraient le même état
   et l'un des deux incréments serait perdu — silencieusement. */
if (!flock($fp, LOCK_EX)) {
    fclose($fp);
    http_response_code(503);
    repondre('occupe');
}

$contenu = stream_get_contents($fp);
$etat = $contenu !== '' ? json_decode($contenu, true) : null;
if (!is_array($etat)) {
    $etat = ['version' => 1, 'indicateurs' => [], 'actes' => [], 'plafond' => []];
}
$etat['indicateurs'] ??= [];
$etat['actes'] ??= [];

$m = mois();
$jeton = 'inconnu';

try {
    // Plafond horaire. Le compteur vit dans le même fichier que le reste :
    // un seul verrou, donc pas de fenêtre entre les deux écritures.
    $heure = (new DateTimeImmutable('now', new DateTimeZone('Europe/Paris')))->format('Y-m-d-H');
    $vues = ($etat['plafond']['heure'] ?? '') === $heure ? (int) ($etat['plafond']['n'] ?? 0) : 0;
    $etat['plafond'] = ['heure' => $heure, 'n' => $vues + 1];

    if ($vues + 1 > PLAFOND_PAR_HEURE) {
        $jeton = 'plafond';
    } elseif ($evenement === 'code') {
        // Rien à écrire : c'est une question, pas un comptage. Seule la
        // tentative est comptée, juste au-dessus.
        $jeton = 'code-ok';
    } elseif ($evenement === 'lire') {
        $jeton = 'lire-ok';
    } elseif ($evenement === 'import') {
        $recu = $data['etat'] ?? null;
        if (is_array($recu)) {
            $plafond = $etat['plafond'] ?? [];
            $etat = assainir($recu);
            $etat['plafond'] = $plafond;   // garde-fou interne, jamais importé
            $jeton = 'import-ok';
        } else {
            $jeton = 'import-vide';
        }
    } elseif (in_array($evenement, ['debut', 'fin', 'pdf', 'acte'], true)) {
        // La ligne du mois ne se crée que pour un événement reconnu : sinon
        // un paquet fantaisiste suffirait à ouvrir un mois vide dans les
        // compteurs, et le rapport hériterait d'une ligne qui ne compte rien.
        $etat['indicateurs'][$m] ??= ligneIndicateurs();
        $ligne = &$etat['indicateurs'][$m];

        switch ($evenement) {
            case 'debut':
                $ligne['commences']++;
                $jeton = 'debut-ok';
                break;

            case 'fin':
                if (!empty($data['complet'])) {
                    $ligne['completes']++;

                    $tranche = isset($data['tranche']) ? (string) $data['tranche'] : '';
                    if (in_array($tranche, TRANCHES, true)) {
                        $ligne[$tranche]++;
                    }

                    $nb = (int) ($data['nb'] ?? 0);
                    if ($nb > 0 && $nb < MAX_VACCINS_PAR_QUESTIONNAIRE) {
                        $ligne['recommandes'] += $nb;
                        ventiler($ligne, 'faits', $data['faits'] ?? 0, $nb);
                        ventiler($ligne, 'verif', $data['verif'] ?? 0, $nb);
                        ventiler($ligne, 'restants', $data['restants'] ?? 0, $nb);
                    }
                }
                $jeton = 'fin-ok';
                break;

            case 'pdf':
                $ligne['pdf']++;
                $jeton = 'pdf-ok';
                break;

            case 'acte':
                /* Ce qui est accepté ici, et rien d'autre : des noms de
                   vaccins et des quantités. Pas d'âge, pas de genre, pas de
                   date plus fine que le mois. Croiser le vaccin avec la
                   tranche d'âge dans une seule officine produirait des cases
                   à 1 ou 2, et un chiffre à 1 redevient quelqu'un. */
                $doses = $data['v'] ?? null;
                if (is_array($doses)) {
                    $etat['actes'][$m] ??= [];
                    foreach (VACCINS as $nom) {
                        $n = (int) ($doses[$nom] ?? 0);
                        if ($n > 0 && $n <= MAX_DOSES_PAR_SAISIE) {
                            $etat['actes'][$m][$nom] = ($etat['actes'][$m][$nom] ?? 0) + $n;
                        }
                    }
                }
                $jeton = 'acte-ok';
                break;
        }
        unset($ligne);
    }

    /* On écrit même pour un événement inconnu : le compteur du plafond a
       été incrémenté, et ne pas le persister rendrait le garde-fou
       inopérant face à un flot d'événements fantaisistes. */
    {
        /* Écriture complète : on repart de zéro plutôt que d'écrire par
           dessus, sinon un document plus court laisserait la queue de
           l'ancien et produirait du JSON invalide. */
        $aEcrire = $etat;
        if ($aEcrire['indicateurs'] === []) { $aEcrire['indicateurs'] = new stdClass(); }
        if ($aEcrire['actes'] === []) { $aEcrire['actes'] = new stdClass(); }
        $json = json_encode($aEcrire, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json !== false) {
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, $json);
            fflush($fp);
        }
    }
} finally {
    flock($fp, LOCK_UN);
    fclose($fp);
}

if ($jeton === 'lire-ok') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    unset($etat['plafond']);   // un garde-fou interne, pas un indicateur
    if ($etat['indicateurs'] === []) { $etat['indicateurs'] = new stdClass(); }
    if ($etat['actes'] === []) { $etat['actes'] = new stdClass(); }
    echo json_encode($etat, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

repondre($jeton);
