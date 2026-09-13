# Indicateurs d'activité — rapport Assurance Maladie

Ce que le questionnaire mesure, comment, et ce qu'il ne peut pas mesurer.

## Principe

Le site ne stocke **aucune donnée individuelle**. Il incrémente des compteurs
mensuels dans un Google Sheet. Il n'existe nulle part de ligne « un patient ».

Conséquence directe : ces compteurs ne sont pas des données personnelles, donc
ni consentement, ni hébergeur certifié HDS, ni analyse d'impact. C'est ce qui
permet d'utiliser un simple Google Sheet, ce qui serait exclu avec du détail
par patient.

## Qui consulte quoi

Le classeur contient deux feuilles :

- **`Tableau de bord`** — ce que les médecins ouvrent. Uniquement des formules :
  totaux depuis le début, taux de complétion, moyenne de vaccins, part des
  45 ans et plus, puis le détail mois par mois. Rien à saisir, tout se
  recalcule seul.
- **`Indicateurs`** — les compteurs bruts, alimentés par le site. On n'y touche
  pas à la main.

### Donner l'accès aux médecins

*Fichier → Partager*, ajouter leurs adresses Google nominativement, rôle
**Lecteur**.

Deux réflexes à garder :

- **Lecteur, pas Éditeur.** Une modification manuelle, même involontaire,
  fausserait des compteurs qu'aucune sauvegarde ne permet de reconstituer.
- **Pas de « Tous les utilisateurs disposant du lien ».** Les chiffres sont
  anonymes, mais c'est un document d'activité interne : il se partage à des
  personnes, pas à un lien.

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
| `Avec situation particulière` | Au moins une situation déclarée — **jamais laquelle** |
| `Total vaccins recommandés` | Somme, à diviser par les complétés pour la moyenne |
| `Impressions PDF` | Clics sur « Imprimer / PDF », indicateur d'intention |

Moyenne de vaccins par questionnaire = `Total vaccins recommandés` ÷
`Questionnaires complétés`.

## Deux règles à ne pas perdre de vue

**Ne jamais publier une case comptant moins de 5 personnes.** Un « 1 » sur une
tranche d'âge, un mois donné, dans une officine donnée, redevient identifiant.
En dessous de 5, regrouper les mois ou les tranches.

**Le détail des situations n'est pas collecté, et ne doit pas l'être.**
« 1 questionnaire, 11-24 ans, mucoviscidose » désigne une personne. Seul le
booléen « au moins une situation » remonte.

## Ce que ces chiffres ne disent pas

**Ils ne prouvent aucun acte vaccinal.** Le nombre de patients vaccinés sort de
la facturation, et l'Assurance Maladie l'a déjà. Les compteurs du site
documentent l'**amont** : l'action de sensibilisation.

Formulation défendable :

> 340 patients ont fait le point sur leurs vaccins via le QR code du comptoir
> ce trimestre, dont 58 % de 45 ans et plus.

Formulation à proscrire, parce qu'elle affirme une causalité que rien
n'établit :

> ~~340 questionnaires → 120 vaccinations~~

Les deux chiffres existent, mais aucun lien technique ne les relie : c'est
exactement ce qui rend les compteurs anonymes.

## Installation

1. Créer un Google Sheet vierge.
2. *Extensions → Apps Script*, y coller `apps-script/Code.gs`, enregistrer.
3. *Déployer → Nouveau déploiement → Application web*, exécuter en tant que
   soi-même, accès « Tout le monde ». Copier l'URL `/exec`.
4. Dans `index.html`, renseigner `const STATS_ENDPOINT = "…/exec";`
5. Vérifier en lançant `testerInstallation()` depuis l'éditeur Apps Script :
   elle crée la ligne du mois **et** la feuille `Tableau de bord`.
6. Partager le classeur en lecture avec les médecins (voir plus haut).

Si le tableau de bord doit être remis à neuf, relancer `installerTableauDeBord()`
depuis l'éditeur : la feuille est recréée, les compteurs ne bougent pas.

Tant que `STATS_ENDPOINT` est vide, **rien n'est envoyé** — les événements
s'affichent seulement dans la console du navigateur.

## Limites connues

L'URL du webhook est visible dans le code source de la page. Quelqu'un qui la
trouve peut gonfler les compteurs. Le risque est faible et sans gravité pour un
indicateur d'activité, mais si un écart suspect apparaît, comparer avec la
fréquentation du comptoir.

L'événement de fin est envoyé quand l'onglet se ferme ou passe en arrière-plan.
Un navigateur tué brutalement peut le perdre : `Questionnaires commencés` est
donc toujours supérieur ou égal à `Questionnaires complétés`, l'écart n'est pas
uniquement de l'abandon.

## Avant de figer le dispositif

Récupérer auprès du contact CPAM **la liste exacte des indicateurs attendus**,
leur mode de calcul et la périodicité de remontée. Si l'un d'eux exige un
dénombrement *par patient*, il ne passera pas par le site : il faudra le sortir
du logiciel métier.
