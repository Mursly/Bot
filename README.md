# 🏹 Ezreal — bot Discord de suivi League of Legends

Ezreal surveille les parties d'un joueur League of Legends et publie automatiquement,
dans un salon Discord, le résultat de chaque partie **accompagné d'une analyse
personnalisée** destinée à l'aider à progresser.

Tout est en français : commandes, messages et analyses.

---

## Sommaire

1. [Ce que fait Ezreal](#1-ce-que-fait-ezreal)
2. [Créer l'application Discord et inviter Ezreal](#2-créer-lapplication-discord-et-inviter-ezreal)
3. [Obtenir et renseigner les clés](#3-obtenir-et-renseigner-les-clés)
4. [Installer et démarrer le bot](#4-installer-et-démarrer-le-bot)
5. [Choisir le joueur et le salon](#5-choisir-le-joueur-et-le-salon)
6. [Maintenir le bot en fonctionnement continu](#6-maintenir-le-bot-en-fonctionnement-continu)
7. [Limites de l'analyse et coûts de l'IA](#7-limites-de-lanalyse-et-coûts-de-lia)
8. [Mode démonstration](#8-mode-démonstration)
9. [Dépannage](#9-dépannage)
10. [Architecture et développement](#10-architecture-et-développement)

---

## 1. Ce que fait Ezreal

- Suit **un joueur par serveur Discord**, identifié par son Riot ID complet `Pseudo#TAG`.
- Interroge les API officielles Riot : **ACCOUNT-V1** pour retrouver le compte,
  **MATCH-V5** pour les parties, leurs statistiques et leur déroulé (timeline).
- Vérifie périodiquement s'il y a de nouvelles parties (60 à 120 s, réglable).
- Publie un message enrichi par partie : résultat, champion, rôle, mode, durée,
  K/D/A, farm et CS/min, participation aux éliminations, dégâts, vision, portrait
  du champion — puis **complète le même message** avec l'analyse.
- Traite les **remakes** à part et permet de **filtrer les modes** suivis.
- Conserve tout dans une base SQLite : le suivi survit aux redémarrages et une
  partie n'est jamais publiée deux fois.

### Commandes disponibles

| Commande | Rôle | Permission requise |
|---|---|---|
| `/suivre joueur:Pseudo#TAG salon:#salon [region] [modes]` | Configure le suivi | **Gérer le serveur** |
| `/arreter` | Arrête le suivi | **Gérer le serveur** |
| `/statut` | Joueur suivi, salon, état du service | aucune |
| `/derniere` | Réaffiche le bilan de la dernière partie | aucune |
| `/aide` | Explique le fonctionnement | aucune |

> ⏱️ **Ezreal ne promet pas de notification instantanée.** Une partie n'est
> lisible qu'une fois traitée par les serveurs Riot, ce qui prend généralement
> quelques minutes après la fin de la partie.

---

## 2. Créer l'application Discord et inviter Ezreal

### 2.1 Créer l'application

1. Ouvrez le [portail développeur Discord](https://discord.com/developers/applications).
2. **New Application** → donnez-lui un nom (par exemple « Ezreal ») → **Create**.
3. Onglet **General Information** : copiez l'**Application ID**.
   C'est la valeur de `DISCORD_CLIENT_ID`.
4. Onglet **Bot** → **Reset Token** → copiez le jeton affiché.
   C'est la valeur de `DISCORD_TOKEN`.

> 🔐 Le jeton ne s'affiche **qu'une seule fois**. Collez-le directement dans
> votre fichier `.env` local. Si vous le perdez, régénérez-en un nouveau.
> Ne le partagez jamais, ne le committez jamais.

### 2.2 Intents

Ezreal n'a besoin **d'aucun intent privilégié**. Sur l'onglet **Bot**, laissez
*Presence Intent*, *Server Members Intent* et *Message Content Intent* **désactivés** :
le bot ne lit pas les messages et n'a pas besoin de la liste des membres.

### 2.3 Inviter le bot

Onglet **OAuth2** → **URL Generator** :

- **Scopes** : `bot` et `applications.commands`
- **Bot Permissions** : `Voir le salon`, `Envoyer des messages`, `Intégrer des liens`

Ou construisez directement l'URL (remplacez `VOTRE_APPLICATION_ID`) :

```
https://discord.com/api/oauth2/authorize?client_id=VOTRE_APPLICATION_ID&permissions=19456&scope=bot%20applications.commands
```

`19456` correspond exactement à ces trois permissions (1024 + 2048 + 16384) —
Ezreal ne demande rien de plus.

> Le salon choisi dans `/suivre` doit accorder ces trois permissions au bot.
> `/suivre` le vérifie et refuse la configuration avec un message explicite si
> l'une manque.

---

## 3. Obtenir et renseigner les clés

### 3.1 Clé API Riot — les trois types et leurs contraintes

Rendez-vous sur le [portail développeur Riot](https://developer.riotgames.com/)
et connectez-vous avec votre compte Riot.

| Type de clé | Comment l'obtenir | Expiration | Limites de débit | Usage autorisé |
|---|---|---|---|---|
| **Development** | Générée automatiquement dès la connexion au portail | **Toutes les 24 h** — à régénérer chaque jour | 20 req / 1 s et 100 req / 2 min | Expérimentation et tests uniquement |
| **Personal** | Enregistrer son produit, sans processus de vérification complet | N'expire pas | Identiques à la clé Development | Usage personnel ou petite communauté privée. **Pas de public ouvert**, même en bêta |
| **Production** | Enregistrement + validation par Riot, prototype fonctionnel généralement exigé | N'expire pas | 500 req / 10 s et 30 000 req / 10 min | Produits destinés à une large communauté |

**En pratique pour Ezreal :**

- Pour essayer : une clé **Development** suffit, mais **le bot cessera de
  fonctionner au bout de 24 h** jusqu'à ce que vous colliez la nouvelle clé dans
  `.env` et redémarriez.
- Pour un usage durable sur votre serveur entre amis : demandez une clé
  **Personal**. C'est le type adapté à ce projet.
- Une clé **Production** n'est nécessaire que si vous ouvrez le bot à un large public.

Ezreal s'auto-limite à **20 requêtes/seconde et 100 requêtes/2 minutes** par
défaut, ce qui correspond aux clés Development et Personal. Il respecte aussi
l'en-tête `Retry-After` renvoyé par Riot en cas de dépassement.

> ℹ️ Les limites sont appliquées **par région**. Avec un seul joueur suivi,
> Ezreal consomme environ 1 à 3 requêtes par cycle de vérification : on reste
> très loin des plafonds.

### 3.2 Clé Anthropic (facultative)

Sans clé Anthropic, **Ezreal fonctionne totalement** : il produit une analyse
factuelle à partir de ses règles internes. La clé sert uniquement à obtenir une
rédaction plus naturelle.

Pour l'activer : [console.anthropic.com](https://console.anthropic.com/settings/keys) →
créer une clé API.

### 3.3 Renseigner les valeurs

Copiez le modèle puis éditez-le **localement** :

```bash
cp .env.example .env
```

Ouvrez `.env` dans votre éditeur et remplissez :

```dotenv
DISCORD_TOKEN=...            # obligatoire
DISCORD_CLIENT_ID=...        # obligatoire
DISCORD_GUILD_ID=...         # facultatif, mais recommandé pour tester
RIOT_API_KEY=...             # obligatoire

ANTHROPIC_API_KEY=           # facultatif
ANTHROPIC_MODEL=claude-sonnet-4-5
ANTHROPIC_MAX_TOKENS=700

POLL_INTERVAL_SECONDS=90
DATABASE_PATH=./data/ezreal.sqlite
LOG_LEVEL=info
DEFAULT_PLATFORM=euw1
```

> 🔐 `.env` est déjà exclu par `.gitignore`. **Ne collez jamais vos clés dans un
> ticket, un salon Discord ou une conversation** — elles ne doivent exister que
> dans ce fichier, sur votre machine.

---

## 4. Installer et démarrer le bot

**Prérequis : Node.js 22.12 ou plus récent.** (`node --version` pour vérifier.)

```bash
# 1. Installer les dépendances
npm install

# 2. Vérifier que tout est sain (aucune clé requise)
npm test

# 3. Publier les commandes slash sur Discord
npm run deploy-commands

# 4a. Démarrer en développement (rechargement automatique)
npm run dev

# 4b. ou compiler puis démarrer en production
npm run build
npm start
```

À propos de l'étape 3 :

- Si `DISCORD_GUILD_ID` est renseigné, les commandes sont publiées **sur ce seul
  serveur et sont disponibles immédiatement**. C'est le mode conseillé pour tester.
- Sinon elles sont publiées globalement, et Discord peut mettre **jusqu'à une
  heure** à les propager.

Relancez `npm run deploy-commands` uniquement si vous modifiez la définition des
commandes.

Au démarrage, Ezreal vérifie la validité de votre clé Riot et s'arrête avec un
message clair si elle est refusée.

---

## 5. Choisir le joueur et le salon

Dans votre serveur Discord, tapez :

```
/suivre joueur:Pseudo#TAG salon:#résultats region:Europe de l'Ouest (EUW)
```

- **joueur** — le **Riot ID complet**, avec le tag. Il est visible en haut du
  client League of Legends, ou sur [account.riotgames.com](https://account.riotgames.com).
  Exemple : `Faker#KR1`. L'ancien « nom d'invocateur » seul ne suffit plus.
- **salon** — le salon textuel où publier. Ezreal vérifie ses permissions avant
  d'accepter.
- **region** — facultatif, **EUW par défaut**. 15 régions disponibles.
- **modes** — facultatif. Liste séparée par des virgules pour ne suivre que
  certains modes, par exemple `soloq,flex`. Sans cette option, tous les modes
  sont suivis.

  Valeurs acceptées : `aram`, `aramclash`, `arena`, `blind`, `bot`, `brawl`,
  `clash`, `draft`, `flex`, `nexusblitz`, `oneforall`, `quickplay`, `soloq`, `urf`.

> 📌 **Seules les parties commencées après l'exécution de `/suivre` sont publiées.**
> L'historique existant du joueur est délibérément ignoré : activer le suivi ne
> déclenche jamais un déversement de vieilles parties dans le salon.

Ensuite :

- `/statut` — vérifier que tout tourne (dernière vérification, incidents, nombre
  de parties publiées).
- `/derniere` — réafficher le dernier bilan.
- `/arreter` — arrêter le suivi. Les messages déjà publiés restent en place.

Relancer `/suivre` remplace simplement la configuration précédente.

---

## 6. Maintenir le bot en fonctionnement continu

Ezreal doit tourner en permanence pour détecter les parties. Choisissez une
méthode selon votre hébergement.

### systemd (serveur Linux — recommandé)

Créez `/etc/systemd/system/ezreal.service` :

```ini
[Unit]
Description=Ezreal — bot Discord League of Legends
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ezreal
WorkingDirectory=/opt/ezreal
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
EnvironmentFile=/opt/ezreal/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ezreal
sudo journalctl -u ezreal -f      # suivre les journaux
```

### pm2

```bash
npm install -g pm2
npm run build
pm2 start dist/index.js --name ezreal
pm2 save && pm2 startup
```

### Docker

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["node", "dist/index.js"]
```

```bash
docker build -t ezreal .
docker run -d --name ezreal --restart unless-stopped \
  --env-file .env -v "$PWD/data:/app/data" ezreal
```

> 💾 **Pensez à conserver le dossier `data/`** (la base SQLite). C'est lui qui
> mémorise le joueur suivi et les parties déjà publiées. Le perdre ferait
> republier des parties ou oublier la configuration.

### Après un redémarrage

Ezreal reprend seul : il relit le suivi en base, ignore toutes les parties déjà
publiées, et remet en file celles dont le traitement avait été interrompu. Si
plus de 5 parties sont en attente, les plus anciennes sont marquées comme
traitées sans notification, pour ne pas inonder le salon après une longue coupure.

---

## 7. Limites de l'analyse et coûts de l'IA

### Ce sur quoi l'analyse s'appuie

**Tous les chiffres sont calculés par le code**, jamais par un modèle d'IA :
CS et CS/min, KDA, participation aux éliminations, part des dégâts de l'équipe,
score de vision par minute, or par minute, temps passé mort, et — quand la
timeline est disponible — CS et or à la 10ᵉ minute, écart avec l'adversaire de
voie, horodatage des morts, événements d'objectifs.

L'analyse s'adapte au **rôle**, au **champion**, au **mode** et à la **durée** :
un support n'est jamais évalué sur son farm, et les repères de voie ne sont pas
appliqués en ARAM ou en Arena.

Chaque remarque suit la même logique :
**observation vérifiable → interprétation prudente → conseil applicable**,
avec au plus 2 points positifs, 3 axes d'amélioration classés par importance, et
1 objectif concret pour la partie suivante.

### Ce qu'Ezreal ne fait pas — et ne fera pas

- ❌ **Il n'a pas regardé la partie.** Il ne sait ni où vous étiez placé, ni
  pourquoi vous êtes mort, ni quel sort vous avez raté. Il ne prétendra jamais
  le contraire.
- ❌ **Il n'invente aucune action de jeu.** Rien qui ne soit dans les données ne
  sera affirmé.
- ❌ **Il n'établit pas de lien de cause à effet non démontré.** Une mort
  survenue juste avant la perte d'un objectif est signalée comme un *moment à
  revoir*, avec la mention explicite qu'il s'agit d'une proximité dans le temps
  et non d'une preuve de responsabilité.
- ❌ **Aucune moyenne par rang, aucun classement, aucune référence au patch
  courant, aucune recommandation d'objets « optimale ».** Ces chiffres ne sont pas
  fournis par l'API et Ezreal n'en invente pas.
- ❌ **Aucun compliment ni reproche de complaisance.** Si rien ne ressort d'une
  partie, il le dit plutôt que de meubler.
- ❌ **Aucun conseil vague** du type « joue mieux » ou « meurs moins ».

Quand les données sont insuffisantes (timeline indisponible, partie trop courte,
rôle non identifiable), Ezreal l'indique dans un champ « Limites de cette analyse »
plutôt que de combler les trous.

Les seuils internes qui décident des sujets abordés sont des **repères de travail**,
pas des normes : ils ne sont jamais présentés au joueur comme une comparaison.

### Coûts de l'IA

| | Sans clé Anthropic | Avec clé Anthropic |
|---|---|---|
| Notifications | ✅ | ✅ |
| Statistiques | ✅ identiques | ✅ identiques |
| Analyse | Rédigée par règles | Rédigée par le modèle, à partir des mêmes faits |
| Coût | **0 €** | Facturé à l'usage |

Maîtrise de la dépense :

- **Un seul appel par partie.** Les analyses sont mises en cache en base : une
  partie déjà analysée n'est jamais repayée, y compris après un redémarrage ou
  via `/derniere`.
- **Aucun appel pour les remakes.**
- **Longueur bornée** par `ANTHROPIC_MAX_TOKENS` (700 par défaut).
- **Modèle configurable** via `ANTHROPIC_MODEL` : vous pouvez choisir un modèle
  moins coûteux.
- **Repli automatique.** Clé absente, erreur réseau, quota dépassé ou réponse
  invalide : Ezreal publie l'analyse par règles. **Une notification n'est jamais
  perdue à cause de l'IA.**

L'ordre de grandeur reste faible : quelques milliers de tokens d'entrée et
quelques centaines de sortie par partie. Les tarifs à jour sont sur
[anthropic.com/pricing](https://www.anthropic.com/pricing).

---

## 8. Mode démonstration

Pour voir le rendu des messages **sans aucune clé et sans rien publier** :

```bash
npm run demo           # rendu texte des 4 scénarios
npm run demo -- --json # embeds au format JSON brut
```

Quatre scénarios sont couverts : victoire d'un ADC, défaite d'un mid avec
timeline, ARAM, et remake.

Les données sont **entièrement fictives** et affichées comme telles
(`JoueurFictif#DEMO`, identifiants `DEMO_…`, bandeau d'avertissement dans chaque
embed). Aucune requête n'est envoyée à Riot, Discord ou Anthropic, et aucun
message n'est publié : il n'y a aucun risque de faire passer un faux résultat
pour une vraie partie.

Le mode démonstration vérifie aussi que chaque embed respecte les limites Discord.

---

## 9. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Ce joueur est introuvable côté Riot » | Riot ID ou région incorrects | Vérifiez l'orthographe exacte et le tag sur account.riotgames.com, et la région choisie |
| « La clé d'API Riot est invalide ou expirée » | Clé Development périmée (24 h) | Régénérez-la sur developer.riotgames.com, mettez `.env` à jour, redémarrez |
| « Ezreal ne peut pas publier dans #salon » | Permissions manquantes | Accordez *Voir le salon*, *Envoyer des messages*, *Intégrer des liens* |
| Les commandes n'apparaissent pas | Commandes non publiées ou propagation globale en cours | Lancez `npm run deploy-commands` ; renseignez `DISCORD_GUILD_ID` pour un effet immédiat |
| Aucune partie publiée | Suivi trop récent, mode filtré, ou partie pas encore traitée par Riot | `/statut` ; rappelez-vous que seules les parties postérieures à `/suivre` comptent |
| « Configuration incomplète » au démarrage | Variables manquantes dans `.env` | Le message liste précisément lesquelles |
| Analyse par règles alors qu'une clé est configurée | Erreur côté IA | Consultez les journaux ; le repli est volontaire et sans perte |

Pour un diagnostic détaillé : `LOG_LEVEL=debug` dans `.env`.

---

## 10. Architecture et développement

```
src/
├── index.ts            Point d'entrée : configuration, connexion, arrêt propre
├── config.ts           Lecture et validation des variables d'environnement
├── poller.ts           Boucle de vérification périodique
├── tracker.ts          Orchestration : détection → calcul → publication → analyse
├── demo.ts / demoData.ts   Mode démonstration (données fictives)
├── riot/
│   ├── client.ts       Client HTTP (limites de débit, Retry-After, reprises)
│   ├── routing.ts      Plateformes et routage régional
│   ├── rateLimiter.ts  Limiteur à fenêtres glissantes
│   ├── queues.ts       Modes de jeu et filtrage
│   ├── ddragon.ts      Portraits de champions (Data Dragon)
│   ├── errors.ts       Erreurs traduites en français
│   └── types.ts        DTO Riot utilisés
├── storage/
│   ├── db.ts           Schéma SQLite et migrations
│   └── repository.ts   Accès aux données, dédoublonnage
├── analysis/
│   ├── stats.ts        Calculs (tous les chiffres viennent d'ici)
│   ├── timeline.ts     Extraction de faits depuis la timeline
│   ├── facts.ts        Dossier de faits transmis au modèle
│   ├── rules.ts        Analyse par règles (socle et repli)
│   └── ai.ts           Intégration Anthropic, cache, garde-fous
└── discord/
    ├── commands.ts     Définition des commandes slash
    ├── deploy.ts       Publication des commandes
    ├── handlers.ts     Traitement des commandes
    ├── embed.ts        Rendu des messages (limites Discord)
    └── publisher.ts    Envoi et modification des messages
```

### Commandes utiles

```bash
npm test            # suite de tests
npm run test:watch  # tests en continu
npm run typecheck   # vérification des types
npm run build       # compilation vers dist/
npm run demo        # rendu de démonstration
```

### Tests

La suite couvre notamment :

- **les calculs** : CS/min, KDA, participation, part des dégâts, et le piège
  documenté de `gameDuration` (secondes ou millisecondes selon la présence de
  `gameEndTimestamp`) ;
- **les doublons** : une partie n'est jamais publiée deux fois, y compris entre
  deux passages ou après un redémarrage ;
- **la reprise après redémarrage** : le suivi et l'historique survivent, les
  traitements interrompus sont repris ;
- **les données manquantes** : timeline absente, champs optionnels absents,
  durée nulle, rôle non identifiable ;
- **l'honnêteté de l'analyse** : aucun conseil vague, aucune moyenne par rang,
  aucune affirmation de causalité sur les objectifs, pas de farm reproché à un support ;
- **les limites Discord** : chaque embed reste dans les plafonds documentés ;
- **la gestion d'API** : `Retry-After`, reprises espacées, erreurs traduites.

---

### Licence et mentions

Ezreal n'est ni affilié à, ni approuvé par Riot Games. League of Legends et Riot
Games sont des marques déposées de Riot Games, Inc.

Ce projet utilise l'API Riot Games et doit respecter les
[conditions d'utilisation des API Riot](https://developer.riotgames.com/policies/general).
