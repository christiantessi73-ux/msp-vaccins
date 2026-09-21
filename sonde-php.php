<?php
/**
 * Sonde temporaire — à supprimer dès le résultat relevé.
 *
 * Elle répond à la seule question qui bloque le passage d'OVH en source de
 * vérité : PHP tourne-t-il, et peut-il écrire AU-DESSUS de la racine web ?
 *
 * Cet emplacement est le point clé. Le miroir de déploiement ne touche que
 * « www/ » : des compteurs rangés au-dessus échappent à son « --delete », et
 * ne sont pas non plus téléchargeables par un visiteur. Si l'écriture y est
 * impossible, toute l'architecture est à revoir.
 *
 * Volontairement muette sans le jeton : une sonde qui décrit le serveur à
 * qui passe n'a pas sa place sur un site public, même une heure.
 */

if (!isset($_GET['t']) || $_GET['t'] !== 'sonde-8f3a2c') {
    http_response_code(404);
    exit;
}

header('Content-Type: text/plain; charset=utf-8');

echo "php            = " . PHP_VERSION . "\n";
echo "racine_web     = " . __DIR__ . "\n";

$dossier = dirname(__DIR__) . '/donnees-msp';
echo "cible          = " . $dossier . "\n";

$existe = is_dir($dossier);
if (!$existe) {
    $existe = @mkdir($dossier, 0700, true);
}
echo "dossier        = " . ($existe ? 'ok' : 'ECHEC') . "\n";

if ($existe) {
    $fichier = $dossier . '/sonde.json';

    // LOCK_EX : c'est le verrou dont dépendront les compteurs. S'il n'est pas
    // honoré ici, deux patients qui terminent ensemble perdront un incrément.
    $ecrit = @file_put_contents($fichier, json_encode(array('t' => time())), LOCK_EX);
    echo "ecriture       = " . ($ecrit === false ? 'ECHEC' : $ecrit . ' octets') . "\n";

    $relu = @file_get_contents($fichier);
    echo "relecture      = " . ($relu === false ? 'ECHEC' : $relu) . "\n";

    @unlink($fichier);
    echo "suppression    = " . (file_exists($fichier) ? 'ECHEC' : 'ok') . "\n";
}

echo "flock          = " . (function_exists('flock') ? 'ok' : 'ABSENT') . "\n";
echo "json_encode    = " . (function_exists('json_encode') ? 'ok' : 'ABSENT') . "\n";
echo "file_put       = " . (function_exists('file_put_contents') ? 'ok' : 'ABSENT') . "\n";

// Le dossier doit rester invisible depuis le web, même s'il était créé
// par erreur dans « www/ » : on le vérifie plutôt que de le supposer.
echo "hors_racine    = " . (strpos($dossier, __DIR__) === 0 ? 'NON - a corriger' : 'ok') . "\n";
