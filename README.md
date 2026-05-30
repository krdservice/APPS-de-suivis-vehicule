# Entretien Auto

Application iPhone/PWA pour suivre l'entretien des vehicules.

## Lancer l'application actuelle

1. Double-cliquez sur `lancer-application.bat`.
2. Ouvrez `http://127.0.0.1:8173` dans votre navigateur.

Sur iPhone, ouvrez cette adresse depuis Safari si votre ordinateur et votre iPhone peuvent acceder au meme reseau local. Les donnees sont enregistrees dans le navigateur.

## Inclus

- Connexion et inscription locale
- Espace personnel par utilisateur : chaque compte voit uniquement ses vehicules, factures, historiques et statistiques
- Ajout de vehicules avec plaque d'immatriculation
- Recherche par plaque via le backend local
- Marque, modele, version, annee, motorisation, puissance fiscale, puissance moteur, carburant et CO2
- Fiche vehicule avec vues avant, arriere et laterale modelisees
- Bouton "Effectuer une revision"
- Categories de revision illustrees
- Historique des interventions, couts et prochaines echeances
- Import de factures PDF associees au vehicule
- Facture PDF optionnelle pendant l'enregistrement d'une revision
- Apercu et telechargement des factures
- Tableau de bord avec vehicules, revisions, factures, depenses et alertes
- Interface premium sombre avec cartes interactives et galerie photo du vehicule

## API plaque avec Next.js

Le remplissage par plaque peut passer par la route Next.js App Router `POST /api/vehicle-by-plate`, afin que la cle ne soit jamais exposee au navigateur.

Creez un fichier `.env.local` a la racine avec :

```text
API_PLAQUE_KEY=votre_cle_api_ici
```

Par defaut, le serveur utilise l'API RapidAPI `api-de-plaque-d-immatriculation-france`.
Si votre fournisseur donne une URL differente, ajoutez aussi :

```text
API_PLAQUE_URL=https://votre-endpoint-api.example/vehicle
API_PLAQUE_PARAM=immatriculation
```

Fichier de route :

```text
app/api/vehicle-by-plate/route.ts
```

Lancement Next.js :

```text
npm install
npm run dev
```
