# ✅ Guide d'installation pas à pas

Ce guide part de zéro et s'arrête quand Ezreal publie sa première partie.
Suivez les étapes **dans l'ordre** : chacune est cochable et se termine par une
vérification qui vous dit si c'est bon.

⏱️ Comptez **20 à 30 minutes** la première fois.

---

## 🗒️ La liste à cocher

Gardez cette liste sous les yeux, le détail de chaque étape est plus bas.

### Préparatifs
- [ ] **0.1** — Installer Node.js 22.12 ou plus récent
- [ ] **0.2** — Récupérer le projet et lancer `npm install`

### Les 4 valeurs à collecter
- [ ] **1.1** — Créer l'application Discord
- [ ] **1.2** — Copier l'**Application ID** → `DISCORD_CLIENT_ID`
- [ ] **1.3** — Créer le bot et copier le **jeton** → `DISCORD_TOKEN`
- [ ] **1.4** — Vérifier que les 3 intents privilégiés sont **désactivés**
- [ ] **2.1** — Activer le mode développeur dans Discord
- [ ] **2.2** — Copier l'**ID de votre serveur** → `DISCORD_GUILD_ID`
- [ ] **3.1** — Récupérer la **clé API Riot** → `RIOT_API_KEY`
- [ ] **4.1** — *(facultatif)* Récupérer la **clé Anthropic** → `ANTHROPIC_API_KEY`

### Mise en route
- [ ] **5.1** — Créer le fichier `.env` et y coller les 4 valeurs
- [ ] **5.2** — Inviter Ezreal sur votre serveur
- [ ] **5.3** — Publier les commandes slash
- [ ] **5.4** — Démarrer le bot
- [ ] **5.5** — Lancer `/suivre` et attendre la première partie

---

# 📋 Le tutoriel détaillé

---

## Étape 0 — Préparatifs

### 0.1 Installer Node.js

Ouvrez un terminal et vérifiez :

```bash
node --version
```

- ✅ **Si ça affiche `v22.12.0` ou plus** → passez à 0.2.
- ❌ Sinon, installez Node.js depuis [nodejs.org](https://nodejs.org) (version **LTS**),
  fermez puis rouvrez votre terminal, et revérifiez.

### 0.2 Récupérer le projet

```bash
git clone <URL-de-votre-dépôt> ezreal
cd ezreal
npm install
```

**Vérification :**

```bash
npm test
```

> ✅ **Attendu :** `Tests  170 passed (170)`.
> Aucune clé n'est nécessaire pour cette étape — si les tests passent, le code
> est sain et le problème éventuel viendra plus tard de la configuration.

Vous pouvez aussi voir à quoi ressembleront les messages, sans aucune clé :

```bash
npm run demo
```

---

## Étape 1 — Discord : l'application et le bot

👉 **Où :** https://discord.com/developers/applications

### 1.1 Créer l'application

1. Connectez-vous avec votre compte Discord habituel.
2. Bouton **`New Application`** en haut à droite.
3. Nom : `Ezreal` (c'est le nom qui s'affichera sur votre serveur).
4. Cochez la case des conditions d'utilisation → **`Create`**.

### 1.2 Copier l'Application ID → `DISCORD_CLIENT_ID`

Vous arrivez sur l'onglet **`General Information`**.

1. Cherchez le champ **`APPLICATION ID`** (une longue suite de chiffres).
2. Cliquez sur **`Copy`**.
3. **Collez-le tout de suite dans un bloc-notes**, vous en aurez besoin à l'étape 5.

> 💡 Celui-ci est réaffichable à tout moment, pas de panique si vous le perdez.

### 1.3 Créer le bot et copier le jeton → `DISCORD_TOKEN`

1. Menu de gauche → onglet **`Bot`**.
2. Bouton **`Reset Token`** → confirmez avec **`Yes, do it!`**
   *(Discord peut demander votre mot de passe ou un code 2FA.)*
3. Un long jeton s'affiche → **`Copy`**.
4. **Collez-le immédiatement dans votre bloc-notes.**

> 🔐 **Attention, c'est le piège classique :** ce jeton ne s'affiche **qu'une
> seule fois**. Si vous quittez la page sans le copier, il faudra refaire
> `Reset Token` (ce qui invalide l'ancien).
>
> Ce jeton donne le contrôle total du bot. Ne le partagez avec personne, ne le
> mettez jamais dans un message Discord, un ticket ou un commit git.

### 1.4 Vérifier les intents

Toujours sur l'onglet **`Bot`**, descendez jusqu'à **`Privileged Gateway Intents`**.

Les trois interrupteurs doivent être **éteints** :

- ⬜ `Presence Intent`
- ⬜ `Server Members Intent`
- ⬜ `Message Content Intent`

> ✅ **C'est normal et voulu.** Ezreal ne lit aucun message et n'a pas besoin de
> la liste des membres. Il ne demande que le strict nécessaire.

---

## Étape 2 — L'identifiant de votre serveur → `DISCORD_GUILD_ID`

Cette valeur est **facultative mais fortement recommandée** : sans elle, vos
commandes slash peuvent mettre **jusqu'à 1 heure** à apparaître. Avec elle,
elles sont disponibles **instantanément**.

### 2.1 Activer le mode développeur

Dans l'application **Discord** (pas le site développeur) :

1. Roue crantée ⚙️ **`Paramètres utilisateur`**, en bas à gauche près de votre pseudo.
2. Menu de gauche → **`Avancés`**.
3. Activez **`Mode développeur`**.
4. Fermez les paramètres.

### 2.2 Copier l'ID du serveur

1. Dans la barre des serveurs à gauche, **clic droit** sur l'icône de votre serveur.
2. Tout en bas du menu → **`Copier l'identifiant du serveur`**.
3. Collez dans votre bloc-notes.

> ✅ **Attendu :** une suite d'environ 18-19 chiffres.
> ❌ Si l'option n'apparaît pas, le mode développeur n'est pas actif : reprenez 2.1.

---

## Étape 3 — La clé Riot → `RIOT_API_KEY`

👉 **Où :** https://developer.riotgames.com

1. **`Login`** en haut à droite, avec votre compte **Riot** (celui du jeu).
2. Une fois connecté, vous arrivez sur votre tableau de bord.
3. Section **`DEVELOPMENT API KEY`** : un champ commençant par `RGAPI-`.
4. Cliquez sur **`REGENERATE API KEY`** si le champ est vide ou expiré.
5. Copiez la clé dans votre bloc-notes.

### ⚠️ Le point important : quelle clé choisir

| Type | Expire | Pour qui | Comment l'obtenir |
|---|---|---|---|
| **Development** | **Toutes les 24 h** | Tests | Automatique dès la connexion |
| **Personal** | Jamais | Vous + quelques amis | Formulaire, sans validation complète |
| **Production** | Jamais | Large public | Validation par Riot, prototype exigé |

> 🔴 **Avec une clé Development, le bot s'arrêtera de fonctionner au bout de 24 h.**
> C'est parfait pour tester aujourd'hui, mais pour un usage durable il faut une
> clé **Personal**.

**Pour demander une clé Personal** (faites-le maintenant, la réponse prend un peu de temps) :

1. Sur le portail → menu en haut à droite → **`REGISTER PRODUCT`**.
2. Choisissez **`PERSONAL API KEY`**.
3. Remplissez le formulaire. Soyez concret dans la description, par exemple :

   > *Bot Discord privé destiné à un petit groupe d'amis. Il suit les parties
   > d'un seul joueur via ACCOUNT-V1 et MATCH-V5, et publie un résumé statistique
   > de chaque partie dans un salon Discord privé. Aucun accès public, aucune
   > revente de données, environ 1 à 3 requêtes par minute.*

4. Une fois approuvée, remplacez simplement `RIOT_API_KEY` dans `.env` et redémarrez.

---

## Étape 4 — La clé Anthropic *(facultative)* → `ANTHROPIC_API_KEY`

> 💡 **Vous pouvez sauter cette étape entièrement.** Sans clé, Ezreal fonctionne
> et produit quand même une analyse complète, rédigée par ses règles internes.
> La clé sert uniquement à obtenir une formulation plus naturelle. **Coût : 0 €
> sans clé.**

Si vous la voulez :

1. Allez sur https://console.anthropic.com
2. Créez un compte, puis **ajoutez du crédit** (`Billing` → quelques euros suffisent
   très largement : un appel par partie, mis en cache).
3. **`Settings`** → **`API keys`** → **`Create Key`**.
4. Copiez la clé (commence par `sk-ant-`) — **elle ne s'affiche qu'une fois**.

---

## Étape 5 — Mise en route

### 5.1 Créer le fichier `.env`

> 🚫 **À ne surtout pas faire : créer ce fichier depuis le site github.com.**
> Le `.gitignore` ne protège que les clones locaux. Un fichier créé depuis
> l'interface web est committé directement, `.gitignore` ou pas — vos clés
> partiraient dans le dépôt. `.env` n'existe **que** sur la machine qui fait
> tourner le bot, jamais sur GitHub.

Dans le dossier du projet, **sur votre machine** :

```bash
cp .env.example .env
```

Sous Windows en `cmd` : `copy .env.example .env` (en PowerShell, `cp` fonctionne).

Ouvrez `.env` dans un éditeur de texte et collez vos 4 valeurs :

```dotenv
DISCORD_TOKEN=collez_le_jeton_de_l_etape_1.3
DISCORD_CLIENT_ID=collez_l_application_id_de_l_etape_1.2
DISCORD_GUILD_ID=collez_l_id_serveur_de_l_etape_2.2
RIOT_API_KEY=RGAPI-collez_la_cle_de_l_etape_3

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5
ANTHROPIC_MAX_TOKENS=700

POLL_INTERVAL_SECONDS=90
DATABASE_PATH=./data/ezreal.sqlite
LOG_LEVEL=info
DEFAULT_PLATFORM=euw1
```

**Bon à savoir :**
- ✅ Collez la valeur **brute**, juste après le `=`. Des guillemets ou des espaces
  autour du `=` seraient tolérés, mais ils n'apportent rien : faites au plus simple.
- ✅ **Laisser une ligne vide après `=` signifie « non configuré ».** C'est le cas
  normal de `ANTHROPIC_API_KEY` si vous sautez l'étape 4.
- ⚠️ La clé Riot commence déjà par `RGAPI-` : collez-la telle quelle, sans
  réécrire le préfixe.
- ⚠️ Vérifiez qu'aucune valeur n'a été coupée au collage — le jeton Discord et
  la clé Anthropic sont longs.

> 🔐 `.env` est déjà exclu de git. Vos clés restent sur votre machine.
> **Ne les collez jamais dans une conversation, un ticket ou un salon.**

### 5.2 Inviter Ezreal sur votre serveur

Prenez l'URL ci-dessous et **remplacez `VOTRE_APPLICATION_ID`** par la valeur de l'étape 1.2 :

```
https://discord.com/oauth2/authorize?client_id=VOTRE_APPLICATION_ID&permissions=19456&scope=bot+applications.commands
```

Ouvrez-la dans votre navigateur → choisissez votre serveur → **`Autoriser`**.

> ℹ️ `19456` = *Voir le salon* + *Envoyer des messages* + *Intégrer des liens*.
> Rien de plus. Vous pouvez vérifier les cases sur l'écran d'autorisation.

**Vérification :** Ezreal apparaît dans la liste des membres de votre serveur
(hors ligne pour l'instant, c'est normal).

### 5.3 Publier les commandes slash

```bash
npm run deploy-commands
```

> ✅ **Attendu :** `5 commandes publiées sur le serveur ... (effet immédiat).`
> ❌ `Configuration incomplète` → une valeur manque dans `.env`, le message dit laquelle.
> ❌ `401 Unauthorized` → le `DISCORD_TOKEN` est incorrect, refaites l'étape 1.3.

### 5.4 Démarrer le bot

```bash
npm run dev
```

> ✅ **Attendu :**
> ```
> [INFO] Clé API Riot valide.
> [INFO] Connecté à Discord en tant que Ezreal#1234 (1 serveur(s)).
> [INFO] Surveillance des parties démarrée (toutes les 90 s).
> ```
> ❌ `Clé API Riot refusée` → clé expirée ou mal copiée, refaites l'étape 3.

Ezreal passe **en ligne** sur votre serveur. **Laissez ce terminal ouvert.**

### 5.5 Configurer le suivi

Dans un salon de votre serveur, tapez `/` : les commandes d'Ezreal doivent
apparaître dans la liste.

```
/suivre joueur:VotrePseudo#TAG salon:#votre-salon
```

- **joueur** — votre **Riot ID complet avec le tag**. Vous le trouvez en haut du
  client League of Legends, ou sur [account.riotgames.com](https://account.riotgames.com).
  Exemple : `Faker#KR1`. ⚠️ L'ancien nom d'invocateur seul ne fonctionne plus.
- **salon** — le salon où publier.
- **region** — facultatif, **EUW par défaut**.
- **modes** — facultatif, ex. `soloq,flex` pour ne suivre que les classées.

> ✅ **Attendu :** `✅ Ezreal suit désormais VotrePseudo#TAG ...`
> ❌ `Ce joueur est introuvable` → vérifiez l'orthographe exacte, le tag, et la région.

### 🎉 C'est terminé

Tapez `/statut` pour confirmer que tout tourne.

**Maintenant : jouez une partie.** Quelques minutes après la fin, Ezreal publiera
le bilan dans le salon choisi.

> 📌 **Important :** seules les parties **commencées après** votre `/suivre`
> sont publiées. Une partie déjà terminée avant ne remontera pas — c'est voulu,
> pour ne pas déverser tout votre historique d'un coup.

---

## 🆘 Ça ne marche pas

| Symptôme | Cause | Solution |
|---|---|---|
| Les commandes `/` n'apparaissent pas | Commandes non publiées, ou `DISCORD_GUILD_ID` absent | Relancez `npm run deploy-commands`. Sans `DISCORD_GUILD_ID`, attendez jusqu'à 1 h |
| `Ce joueur est introuvable` | Riot ID ou région erronés | Vérifiez sur account.riotgames.com, et la région choisie |
| `La clé d'API Riot est invalide ou expirée` | Clé Development périmée (24 h) | Régénérez sur developer.riotgames.com, mettez `.env` à jour, redémarrez |
| `Ezreal ne peut pas publier dans #salon` | Permissions manquantes sur ce salon | Paramètres du salon → Permissions → autorisez Ezreal à *Voir le salon*, *Envoyer des messages*, *Intégrer des liens* |
| Le bot est hors ligne | Le terminal a été fermé | Relancez `npm run dev`, ou passez à l'étape « fonctionnement continu » |
| Aucune partie après avoir joué | Partie antérieure au `/suivre`, mode filtré, ou traitement Riot en cours | `/statut` pour voir la dernière vérification et les incidents |
| `Configuration incomplète` | Variables manquantes dans `.env` | Le message liste exactement lesquelles |

Pour plus de détail dans les journaux : mettez `LOG_LEVEL=debug` dans `.env` et redémarrez.

---

## 🔁 Et après ? Le garder allumé

`npm run dev` s'arrête dès que vous fermez le terminal. Pour un fonctionnement
permanent, voir la section
**[« Maintenir le bot en fonctionnement continu »](README.md#6-maintenir-le-bot-en-fonctionnement-continu)**
du README : recettes prêtes à l'emploi pour **systemd**, **pm2** et **Docker**.

Le plus simple si vous avez déjà un serveur :

```bash
npm install -g pm2
npm run build
pm2 start dist/index.js --name ezreal
pm2 save && pm2 startup
```

> 💾 **Sauvegardez le dossier `data/`.** C'est lui qui mémorise le joueur suivi
> et les parties déjà publiées. Le perdre ferait republier d'anciennes parties.

---

## 📎 Aide-mémoire

| Ce qu'il vous faut | Où le trouver | Expire ? |
|---|---|---|
| `DISCORD_CLIENT_ID` | Portail dev Discord → *General Information* → Application ID | Non |
| `DISCORD_TOKEN` | Portail dev Discord → *Bot* → Reset Token | Non (sauf régénération) |
| `DISCORD_GUILD_ID` | Discord → clic droit sur le serveur → Copier l'identifiant | Non |
| `RIOT_API_KEY` | developer.riotgames.com | **Oui, 24 h** pour une clé Development |
| `ANTHROPIC_API_KEY` | console.anthropic.com → Settings → API keys | Non |

| Commande | Effet |
|---|---|
| `npm test` | Vérifie que le code est sain (aucune clé requise) |
| `npm run demo` | Montre le rendu des messages (aucune clé requise) |
| `npm run deploy-commands` | Publie les commandes slash sur Discord |
| `npm run dev` | Démarre le bot (rechargement auto) |
| `npm run build` && `npm start` | Démarre en mode production |
