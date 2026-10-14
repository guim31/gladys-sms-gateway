# SMS Gateway for Android

Envoyez des SMS depuis vos scènes Gladys, et lancez des scènes à la réception
d'un SMS, avec un téléphone Android et l'application libre
[SMS Gateway for Android](https://github.com/capcom6/android-sms-gateway). Ça
marche avec n'importe quel opérateur, sans service tiers payant : un vieux
téléphone avec une carte SIM suffit.

**Développée sans le matériel : vos retours sont les bienvenus.** Cette
intégration a été écrite et testée contre une simulation de l'API de
l'application, pas avec un vrai téléphone. Dites ce qui marche et ce qui ne
marche pas sur [GitHub](https://github.com/guim31/gladys-sms-gateway/issues).

Cette intégration n'est pas affiliée au projet SMS Gateway for Android.

## Prérequis

- Gladys 5.1.0 ou plus récent.
- Un téléphone Android (5.0 ou plus) avec une carte SIM qui peut envoyer des
  SMS, branché en permanence.
- L'application SMS Gateway for Android, en version 1.59.0 ou plus pour lire
  les SMS reçus :
  [téléchargez-la sur GitHub](https://github.com/capcom6/android-sms-gateway/releases).
- Les tarifs de votre opérateur s'appliquent à chaque SMS envoyé.

## Configuration

Ouvrez l'application, puis choisissez comment Gladys joint le téléphone.

### Réseau local (recommandé)

1. Dans l'application, activez **Local server**. Elle affiche l'adresse (par
   exemple `192.168.1.50:8080`), un utilisateur et un mot de passe.
2. Donnez au téléphone une adresse fixe dans votre box.
3. Dans Gladys, choisissez **Réseau local**, puis saisissez l'adresse,
   l'utilisateur et le mot de passe.

Rien ne sort de chez vous : Gladys parle au téléphone sur votre réseau.

### Serveur cloud

1. Dans l'application, activez **Cloud server**. Elle affiche un utilisateur et
   un mot de passe.
2. Dans Gladys, choisissez **Serveur cloud**, puis saisissez l'utilisateur et
   le mot de passe.

Les SMS passent par le serveur public du projet, `api.sms-gate.app`, tenu par
son auteur. Activez le réglage **Ping** de l'application pour que le serveur
sache que le téléphone est en vie, et choisissez dans **Téléphone injoignable
après (cloud)** la durée de silence acceptable.

### Serveur privé

Si vous hébergez vous-même le serveur SMS Gateway, choisissez **Serveur privé**
et saisissez son adresse (par exemple `https://sms.example.com`), puis
l'utilisateur et le mot de passe de la carte **Cloud server** de
l'application. L'interrupteur « Préférer la connexion locale » affiché par
Gladys n'a pas d'effet ici : c'est le réglage **Connexion** qui décide.

### Sécurité des envois

Un SMS peut coûter de l'argent, et une scène peut boucler (par exemple une
scène qui répond à chaque SMS reçu, face à une réponse automatique). **SMS par
heure, au plus** (20 par défaut) plafonne ce que Gladys envoie sur toute heure
glissante : au-delà, le SMS est refusé, la scène dit pourquoi et quand le
prochain passera. Un message à trois numéros compte pour trois SMS. La limite
survit à un redémarrage de l'intégration.

### SMS reçus et rafraîchissement

Gladys lit le téléphone à l'**Intervalle de rafraîchissement** (1 minute par
défaut) : son état, les SMS qu'il a envoyés, et les SMS reçus, qui lancent les
scènes du déclencheur **SMS reçu**. Désactivez **Lire les SMS reçus** si vous
ne faites qu'envoyer. **Langue des noms et messages** fixe les noms des
appareils (français par défaut) et la langue des messages de l'action de
scène.

## L'appareil

Chaque téléphone devient un appareil **Passerelle SMS** dans l'onglet
Découverte, avec :

| Fonctionnalité        | Ce qu'elle montre                                                                   |
| --------------------- | ----------------------------------------------------------------------------------- |
| Téléphone joignable   | 1 quand le téléphone répond (local), ou a contacté le serveur récemment (cloud)     |
| Batterie du téléphone | Niveau de batterie, en pourcentage (mode local uniquement)                          |
| Téléphone en charge   | 1 quand le téléphone charge (mode local uniquement)                                 |
| SMS envoyés           | SMS envoyés par Gladys depuis l'installation de l'intégration (un par destinataire) |
| SMS en échec          | SMS qui n'ont pas pu partir ou être délivrés                                        |
| SMS reçus             | SMS reçus pendant que Gladys lisait le téléphone                                    |

Une scène peut s'en servir comme de tout appareil : « si Batterie du téléphone
est sous 20 » ou « si Téléphone joignable vaut 0 », pour être prévenu par un
autre canal.

## Action de scène : Envoyer un SMS

L'action **Envoyer un SMS** envoie un message :

- **Numéros (format international)** : `+33639980012`, plusieurs séparés par
  des virgules (10 au plus). Un numéro national comme `0639980012` est refusé :
  le format international est le seul qui veut dire la même chose pour toutes
  les cartes SIM.
- **Texte** : jusqu'à 1600 caractères (un texte long fait plusieurs SMS pour
  votre opérateur). Tapez `{{` pour insérer une information de la scène : la
  valeur d'un capteur, l'expéditeur du SMS reçu, la réponse de l'IA…
- **Carte SIM** : celle par défaut du téléphone, ou SIM 1, 2 ou 3 sur un
  téléphone double SIM.
- **Téléphone** : en mode cloud avec plusieurs téléphones, celui qui envoie.

Les actions suivantes de la scène peuvent lire l'**Identifiant du message**, le
**Nombre de destinataires** et l'**État à la mise en file** (`pending`,
`sent`, `delivered`, `failed`). Si le SMS ne peut pas partir (numéro invalide,
limite horaire atteinte, téléphone injoignable), l'action échoue avec la raison
dans les logs de la scène, et la scène continue.

Pour recevoir les messages de Gladys par SMS, ajoutez cette action là où vos
scènes utilisent « Envoyer un message », avec le même texte.

## Déclencheurs de scène

### SMS reçu

Lance la scène quand le téléphone reçoit un SMS. Filtres : l'**Expéditeur**
(exactement comme le téléphone l'affiche : `+33639980012`, ou un nom comme
celui d'une banque ; vide = n'importe qui) et le **Téléphone**. Informations
transmises aux actions : l'expéditeur, le **Texte du SMS**, l'heure de
réception et la carte SIM.

Chaque SMS lance les scènes une seule fois, même après un redémarrage. Les SMS
déjà présents dans le téléphone au démarrage de l'intégration ne sont pas
annoncés. Un SMS reçu n'est jamais un ordre d'une personne de confiance :
l'expéditeur d'un SMS peut être falsifié.

### SMS en échec

Lance la scène quand un SMS envoyé par Gladys n'a pas pu partir ou être
délivré, avec les destinataires non atteints et la raison donnée par le
téléphone. Pratique pour se rabattre sur un autre canal.

## Widget

Le widget **Passerelle SMS** affiche la batterie, les SMS envoyés dans l'heure
face à la limite, les SMS reçus, si chaque téléphone est joignable, et l'état
des cinq derniers SMS envoyés. Le bouton **Actualiser** lit le téléphone tout
de suite. Choisissez un téléphone dans ses réglages, ou laissez vide pour tous.

## Actions de l'écran Configuration

- **Tester la connexion** : lit le téléphone maintenant et dit ce qui répond :
  téléphone, batterie, version de l'application, boîte de réception, SMS de
  l'heure.
- **Envoyer un SMS de test** : envoie un SMS au numéro saisi, sous la même
  limite.
- **Derniers SMS** : les derniers SMS envoyés par Gladys et leur état : en
  attente, envoyé, délivré ou échec.

## Exemples de scènes

- **Fuite d'eau** : déclencheur « un détecteur de fuite détecte de l'eau » →
  action **Envoyer un SMS** à deux numéros, « Fuite d'eau dans la buanderie ! ».
- **SMS transférés** : déclencheur **SMS reçu** → envoyer un message Gladys
  « SMS de » suivi de l'**Expéditeur** et du **Texte du SMS** (tapez `{{` pour
  les insérer), pour lire les SMS d'une deuxième ligne dans l'application
  Gladys.
- **Accusé de réception** : déclencheur **SMS reçu** avec l'expéditeur
  `+33639980012` → **Envoyer un SMS** à l'**Expéditeur** (inséré avec `{{`) :
  « Bien reçu, merci ». N'armez ni ne désarmez jamais une alarme, n'ouvrez
  jamais une porte sur un SMS : son expéditeur peut être falsifié.
- **Plan B** : déclencheur **SMS en échec** → envoyer un message par Telegram
  avec les destinataires non atteints.
- **Surveillance du vieux téléphone** : déclencheur « Batterie du téléphone
  est sous 15 » → prévenir la famille sur l'application Gladys.

## Dépannage

- **« pas de réponse »** : le téléphone est éteint, l'application arrêtée, ou
  l'adresse a changé. Ouvrez l'application, vérifiez que le serveur est actif et
  qu'Android ne la met pas en veille (Paramètres → Batterie → pas
  d'optimisation pour SMS Gateway).
- **« utilisateur ou mot de passe refusé »** : recopiez-les depuis
  l'application ; les couples local et cloud sont différents.
- **« adresse inconnue de l'API »** : mettez l'application à jour ; pour un
  serveur privé, vérifiez son adresse.
- **Aucun SMS reçu dans Gladys** : l'application doit être en 1.59.0 ou plus,
  et **Lire les SMS reçus** activé. Dans l'application, le chiffrement de bout en
  bout doit être désactivé : un SMS chiffré ne peut pas être lu.
- **« Limite de 20 SMS par heure atteinte »** : une scène envoie plus que
  prévu. Cherchez une boucle, ou relevez la limite.
- **Le SMS reste « envoyé »** : votre opérateur ne renvoie pas d'accusés de
  réception.
- Logs : Intégrations → SMS Gateway for Android → Logs. Mettez
  `LOG_LEVEL=debug` pour voir chaque lecture. Les numéros apparaissent masqués
  (deux derniers chiffres), les textes jamais.

## Limites

- Développée sans téléphone : l'API a été simulée d'après sa documentation et
  son code source.
- SMS seulement : pas de MMS, pas de SMS de données binaires.
- Les SMS reçus sont lus à chaque intervalle (1 minute par défaut), pas
  instantanément : les webhooks de l'application demandent une adresse que le
  téléphone peut joindre, ce que le bac à sable de Gladys n'offre pas.
- La batterie n'est connue qu'en mode local ; en mode cloud, « Téléphone
  joignable » dépend du dernier contact de l'application avec le serveur.
- « Envoyer un message » du cœur et les messages système ne partent pas par
  SMS : utilisez l'action **Envoyer un SMS** dans vos scènes.
- Un certificat auto-signé sur un serveur privé est refusé.
- Android limite lui-même le nombre de SMS qu'une application peut envoyer en
  peu de temps : au-delà, le téléphone peut demander une confirmation sur son
  écran.
