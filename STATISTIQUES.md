# Indicateurs d'activité — rapport Assurance Maladie

Ce que le questionnaire mesure, comment, et ce qu'il ne peut pas mesurer.

## Principe

Le site ne stocke **aucune donnée individuelle**. Il incrémente des compteurs
mensuels. Il n'existe nulle part de ligne « un patient ».

Conséquence directe : ces compteurs ne sont pas des données personnelles, donc
ni consentement, ni hébergeur certifié HDS, ni analyse d'impact. Ce serait
exclu avec du détail par patient.

## Où vivent les chiffres

**Une seule source de vérité : l'hébergement OVH.** Les pages appellent
`api.php`, sur leur propre domaine, qui incrémente un fichier de compteurs.

Ce fichier est rangé dans `/home/mspvacu/donnees-msp/`, **au-dessus de la
racine web**, et c'est l'emplacement qui rend tout le reste possible :

- le miroir de déploiement ne touche que `www/`, donc son `--delete` n'efface
  pas les compteurs à chaque publication du site ;
- rien de ce qui s'y trouve n'est téléchargeable par un visiteur.

Un fichier de compteurs rangé dans `www/` serait détruit à la première mise à
jour. C'est précisément ce qu'on cherchait à éviter.

**Le Google Sheet est une vue.** Un script Apps Script lit `api.php` toutes les
heures et réécrit les feuilles `Indicateurs` et `Actes` de fond en comble. On
n'y saisit jamais rien : les deux endroits ne peuvent pas diverger puisque l'un
est calculé depuis l'autre.

Le classeur y gagne un second rôle : une **copie hors-site** des compteurs,
avec l'historique de versions de Google Sheets par-dessus.

### Les quatre secrets

Ils vivent tous dans `/home/mspvacu/donnees-msp/config.php`, jamais dans Git.

| Secret | Ce qu'il ouvre |
|---|---|
| `cle` | rien à lui seul. Partagée avec les pages, donc visible dans leur code source : c'est le navigateur du visiteur qui appelle `api.php` |
| `pin` | la saisie des doses sur `acte.html`, et la lecture des compteurs. C'est le code du comptoir, il circule entre les mains de l'équipe |
| `lecture` | la lecture seule. Réservé au script de synchronisation — le code du comptoir se change souvent, on oublierait de le reporter dans un script qui tourne tout seul |
| `admin` | le remplacement complet des compteurs. **Absent de `config.php` en temps normal** : sans lui, aucune requête ne peut effacer un trimestre de relevés. On ne le remet que le temps d'une migration |

## Qui consulte quoi

Le classeur contient trois feuilles :

- **`Tableau de bord`** — ce que les médecins ouvrent. Uniquement des formules :
  totaux depuis le début, taux de complétion, moyenne de vaccins, part des
  45 ans et plus, puis le détail mois par mois. Rien à saisir, tout se
  recalcule seul.

  Deux graphiques s'y actualisent seuls : la répartition des questionnaires
  complétés par tranche d'âge, et l'activité mois par mois (commencés face aux
  complétés). Des colonnes, jamais de camembert : un secteur ne permet pas de
  comparer des valeurs proches, ce qui est précisément la question posée. Leurs
  deux couleurs restent distinguables en vision des couleurs déficiente.
- **`Indicateurs`** — les compteurs du questionnaire, **réécrits** à chaque
  synchronisation depuis OVH. Toute saisie manuelle disparaît à l'heure
  suivante.
- **`Actes`** — les doses administrées, réécrites de la même façon. Une ligne
  par mois, une colonne par vaccin.

Le tableau de bord porte en `A3` la date du dernier relevé réussi. **C'est la
première chose à regarder devant un chiffre qui surprend** : une
synchronisation arrêtée laisse un tableau parfaitement crédible et périmé.

### Donner l'accès aux médecins de l'hôpital

Les trois feuilles vivent dans le **même classeur** : partager le fichier donne
accès au tableau de bord *et* aux compteurs bruts, il n'y a rien à partager
séparément.

**Rôle : Lecteur, jamais Éditeur.** Une saisie manuelle, même involontaire,
fausserait des compteurs qu'aucune sauvegarde ne permet de reconstituer. Les
feuilles `Indicateurs` et `Actes` sont en plus protégées en mode
avertissement : le script écrit librement, un humain reçoit une demande de
confirmation.

Deux façons de procéder, selon les comptes des médecins :

**S'ils ont une adresse Google** (Gmail ou Workspace de l'hôpital) —
*Fichier → Partager*, ajouter les adresses nominativement, rôle **Lecteur**.
C'est le plus propre : on sait qui a accès, et on retire un accès en un clic.

**S'ils n'ont pas de compte Google** — beaucoup d'adresses hospitalières n'en
sont pas. Deux options :

- *Partager → Tous les utilisateurs disposant du lien → Lecteur*, puis envoyer
  le lien. Acceptable **parce que ces chiffres sont anonymes** : il n'y a rien
  à protéger au sens du RGPD. Ce serait exclu avec des données par patient.
- *Fichier → Partager → Publier sur le web* : produit une page en lecture
  seule, sans compte, qu'on peut limiter à la feuille `Tableau de bord`.

Dans les deux cas, ne pas diffuser le lien au-delà des destinataires du
rapport, et le renouveler si la liste des médecins change.

Les médecins n'ont besoin d'aucun droit sur le script Apps Script : il
s'exécute sous ton compte, indépendamment de qui lit le classeur.

## Les indicateurs produits

Une ligne par mois, dans la feuille `Indicateurs` :

| Colonne | Ce qu'elle compte |
|---|---|
| `Mois` | Mois de recueil, format `2026-09` |
| `Questionnaires commencés` | Première interaction avec le formulaire |
| `Questionnaires complétés` | Genre **et** âge renseignés |
| `11-24 ans` … `65 ans et plus` | Répartition des questionnaires complétés |
| `Total vaccins recommandés` | Somme, à diviser par les complétés pour la moyenne |
| `Vaccins déjà faits (déclarés)` | Vaccins marqués « Déjà fait » par le patient |
| `Vaccins à vérifier` | Vaccins marqués « Je ne sais plus » |
| `Vaccins restant à faire` | Le reste : ni faits, ni à vérifier |

Moyenne de vaccins par questionnaire = `Total vaccins recommandés` ÷
`Questionnaires complétés`.

Couverture déclarée = `Vaccins déjà faits` ÷ `Total vaccins recommandés`. Les
trois dernières colonnes s'additionnent pour retomber sur `Total vaccins
recommandés` : c'est le contrôle de cohérence de la feuille.

**Pourquoi « à vérifier » reste une colonne à part.** C'est une non-réponse,
pas un vaccin manquant. Un patient qui ne touche aucun bouton laisse tout en
« restant à faire » : cette colonne mélange donc du vrai non-fait et du
silence. Fondre « à vérifier » dans l'une des deux autres effacerait la seule
trace de cette incertitude.

### Les vaccins administrés — feuille `Actes`

Alimentée par `acte.html`, une page distincte du questionnaire, réservée à
l'équipe et accessible par un QR code affiché au comptoir et au cabinet.

La page s'ouvre **verrouillée** : tant que le code de l'équipe n'a pas été
validé, le formulaire n'est pas affiché. Le code n'est pas comparé dans la
page — il est envoyé à `api.php`, qui répond `code-ok` ou `code-refuse`. C'est
ce qui permet de ne l'écrire nulle part dans une page publique : elle ne le
connaît pas, elle le demande.

Chaque événement a son propre jeton de réponse, et c'est délibéré : une
version antérieure du serveur ne connaît pas la branche, tombe au bout de la
fonction et répondrait « ok » à tout. La page exige le jeton exact, ce qui
transforme un déploiement à moitié fait en erreur franche à l'écran plutôt
qu'en saisie perdue en silence.

Une fois déverrouillé, le soignant compte les doses avec les boutons − / + et
valide. **Les compteurs repartent à zéro dès que l'enregistrement est
confirmé**, pour qu'un second appui ne puisse pas recompter les mêmes doses.
À l'inverse, un échec — code refusé, réseau coupé — laisse la saisie à
l'écran : au comptoir, refaire un comptage de mémoire, c'est le perdre.

Le code validé reste en mémoire le temps de la session, et nulle part
ailleurs : ni cookie, ni `localStorage`. Recharger la page le redemande, ce
qui est voulu sur un téléphone de comptoir qui passe de main en main.

| Colonne | Ce qu'elle compte |
|---|---|
| `Mois` | Mois de saisie, format `2026-09` |
| `DTPc` … `Méningocoque B` | Doses administrées, une colonne par vaccin |
| `Total actes` | Somme des colonnes précédentes |

**Rien d'autre ne remonte.** Pas d'âge, pas de genre, pas de date plus fine
que le mois, et surtout aucun croisement. « Grippe : 12 ce mois » est anonyme ;
« Grippe, femme, 45-64 ans, le 21 » est une donnée de santé nominative dans
une officine où l'on sait qui est passé. La tentation d'enrichir cette feuille
est la seule façon de faire s'écrouler tout l'édifice décrit plus haut.

**Ces compteurs sont un plancher, jamais un total.** Tout repose sur le fait
qu'un soignant pense à saisir, un jour d'affluence. Une dose non saisie est
perdue pour le rapport. Il faut donc surveiller le taux de saisie les premières
semaines — en comparant avec la facturation — et écrire dans le rapport qu'il
s'agit d'un minimum.

**`Actes` et `Indicateurs` ne se divisent pas l'un par l'autre.** Un vaccin
fait au comptoir n'a pas forcément suivi un questionnaire, et rien dans le
dispositif ne permet de le savoir : le QR code du comptoir est le même pour
tous, il ne porte aucune trace du bilan d'un patient. C'est délibéré — c'est
ce qui maintient les deux feuilles anonymes. Les deux séries se lisent côte à
côte, jamais en rapport.

Le code de l'équipe (`pin`, dans `config.php` **uniquement**) a le même statut
que la clé partagée : il évite la fausse manœuvre — un patient qui scanne
l'affiche par curiosité — pas quelqu'un de déterminé. Il n'a rien à protéger :
`acte.html` ne sait qu'ajouter des doses.

## Deux règles à ne pas perdre de vue

**Ne jamais publier une case comptant moins de 5 personnes.** Un « 1 » sur une
tranche d'âge, un mois donné, dans une officine donnée, redevient identifiant.
En dessous de 5, regrouper les mois ou les tranches.

**Aucune situation particulière n'est collectée.** Depuis la simplification
demandée par la MSP en septembre 2026, le questionnaire ne pose plus la question :
il invite le patient à en parler à l'équipe. Si elle devait revenir un jour, ne
jamais remonter le détail — « 1 questionnaire, 11-24 ans, mucoviscidose »
désigne une personne.

## Ce que ces chiffres ne disent pas

**La feuille `Indicateurs` ne prouve aucun acte vaccinal.** Elle documente
l'**amont** : l'action de sensibilisation. Le nombre exact de patients vaccinés
sort de la facturation, et l'Assurance Maladie l'a déjà.

**La feuille `Actes` compte de vraies doses, mais reste déclarative** — c'est
l'équipe qui saisit, à la main, entre deux patients. Elle dit « au moins tant
de doses », jamais « exactement tant ».

Formulations défendables :

> 340 patients ont fait le point sur leurs vaccins via le QR code du comptoir
> ce trimestre, dont 58 % de 45 ans et plus.

> Sur la même période, l'équipe a saisi au moins 120 doses administrées sur
> place, dont 64 vaccins antigrippaux.

Formulation à proscrire, parce qu'elle affirme une causalité que rien
n'établit :

> ~~340 questionnaires → 120 vaccinations~~

Les deux chiffres existent, mais aucun lien technique ne les relie — le QR code
du comptoir est identique pour tous et ne porte rien du bilan d'un patient.
C'est précisément ce qui rend les deux feuilles anonymes, et c'est le prix à
payer pour s'en tenir à un Google Sheet.

> Si la CPAM demande un jour un **taux de conversion** (« quelle part des
> vaccins recommandés a été administrée dans la foulée ? »), il faudrait un QR
> code pré-rempli sur le bilan de chaque patient. C'est techniquement faisable,
> mais cela mettrait des données de santé dans l'URL du QR : elles devraient
> alors impérativement rester dans le **fragment** (après le `#`), jamais dans
> la query string (après le `?`), sans quoi elles atterriraient dans les logs
> d'OVH, hébergeur non certifié HDS. À n'envisager qu'après avoir vérifié, sur
> plusieurs mois, que la saisie des actes tient.

## Installation

### 1. Sur OVH

Le miroir de déploiement publie `api.php` tout seul. Reste la configuration,
à déposer **à la main** en `/home/mspvacu/donnees-msp/config.php` — au-dessus
de `www/`, jamais dedans :

```php
<?php
return [
    'cle'     => 'msp-84feb9a16b719652c1d0286d',  // identique à STATS_CLE
    'pin'     => '…',                              // le code du comptoir
    'lecture' => '…',                              // pour la synchronisation
];
```

Vérifier depuis n'importe où que le dossier reste invisible :

```
curl -o /dev/null -w "%{http_code}\n" https://msp-vaccins.fr/donnees-msp/config.php
```

Un `404` est le résultat attendu. Autre chose signifie que le dossier est dans
`www/` et doit être déplacé sans attendre.

### 2. Le script de synchronisation

1. *Extensions → Apps Script*, y coller `apps-script/Code.gs`, enregistrer.
2. *Paramètres du projet → Propriétés du script*, ajouter les trois valeurs.
   Elles ne sont pas dans le fichier, donc pas dans Git :

   | Propriété | Valeur |
   |---|---|
   | `API` | `https://msp-vaccins.fr/api.php` |
   | `CLE` | la valeur de `cle` dans `config.php` |
   | `LECTURE` | la valeur de `lecture` dans `config.php` |

3. Lancer `testerSynchronisation()` : elle vérifie l'accès, recopie les
   compteurs et installe le tableau de bord.
4. Lancer `installerSynchronisation()` : elle pose le déclencheur horaire.
5. Partager le classeur en lecture avec les médecins (voir plus haut).

Il n'y a **plus de déploiement en application web**. Ce script n'est appelé par
personne, c'est lui qui appelle. L'ancien déploiement `/exec` peut être
archivé : plus rien ne lui écrit.

### 3. Le QR code de l'équipe

Imprimer un QR vers `https://msp-vaccins.fr/acte.html` et l'afficher au
comptoir et au cabinet, **hors de vue des patients**. Ce n'est pas le même que
celui du questionnaire.

> **Changer un secret** : modifier `config.php`, puis reporter la valeur là où
> elle est attendue — `STATS_CLE` dans les deux pages pour `cle`, les
> propriétés du script pour `lecture`. Le code du comptoir, lui, ne se recopie
> nulle part : il n'existe que dans `config.php`.

Si le tableau de bord doit être remis à neuf, relancer `installerTableauDeBord()`
depuis l'éditeur : la feuille est recréée, les compteurs ne bougent pas — ils
ne sont pas là.

> **Ajouter une colonne plus tard** : la liste des vaccins doit rester
> identique et dans le même ordre aux quatre endroits qui la portent —
> `VACCINES` dans `index.html`, `VACCINS` dans `acte.html`, `VACCINS` dans
> `api.php` et `VACCINS` dans `Code.gs`. Un nom qui diverge se compterait dans
> la colonne d'un autre.

## Limites connues

**La clé est publique, et doit l'être.** C'est le navigateur du visiteur qui
appelle `api.php` : la clé est forcément dans le code source des pages. Elle
écarte les robots et les appels au hasard, pas quelqu'un qui lit la page.

D'où le second garde-fou : `api.php` ignore tout ce qui dépasse
`PLAFOND_PAR_HEURE` appels dans l'heure — 200 par défaut, très au-dessus de la
fréquentation réelle du comptoir. Les tentatives de code y sont comptées, ce
qui rend une recherche exhaustive impraticable.

Le pire scénario reste donc des compteurs gonflés, jamais une fuite. Contre­partie
assumée : quelqu'un d'acharné peut saturer le plafond et bloquer les comptages
pendant une heure. Si un écart suspect apparaît, comparer avec la fréquentation
du comptoir.

**Le questionnaire peut perdre son événement de fin.** Il part quand l'onglet
se ferme ou passe en arrière-plan ; un navigateur tué brutalement l'emporte.
`Questionnaires commencés` est donc toujours supérieur ou égal à
`Questionnaires complétés`, et l'écart n'est pas uniquement de l'abandon.

**Le classeur peut être en retard, jamais faux.** La synchronisation passe
toutes les heures. Si elle échoue — OVH injoignable, secret mal recopié — elle
lève et **ne touche pas au classeur** : celui-ci garde les chiffres du dernier
relevé réussi, ce qui vaut mieux qu'un tableau de bord vidé par une coupure
passagère. La date en `A3` du tableau de bord est ce qui rend ce retard
visible.

**Les doses administrées sont un plancher.** Tout repose sur le fait qu'un
soignant pense à saisir, un jour d'affluence. Une dose non saisie est perdue
pour le rapport. Surveiller le taux de saisie les premières semaines en le
comparant à la facturation, et écrire dans le rapport qu'il s'agit d'un
minimum.

## Avant de figer le dispositif

Récupérer auprès du contact CPAM **la liste exacte des indicateurs attendus**,
leur mode de calcul et la périodicité de remontée. Si l'un d'eux exige un
dénombrement *par patient*, il ne passera pas par le site : il faudra le sortir
du logiciel métier.
