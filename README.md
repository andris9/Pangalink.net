# Pangalinker

## Eeldused

  * [Node.js](http://nodejs.org/), vähemalt versioon 5.0.0
  * [MongoDB](http://www.mongodb.org/)
  * OpenSSL käsurea utiliit. Linux põhistes süsteemides reeglina vaikimisi olemas, Windowsis tuleb see ise [paigaldada](https://blog.didierstevens.com/2015/03/30/howto-make-your-own-cert-with-openssl-on-windows/)

## Install

    npm install --production

## Windowsi kasutajatele

Pangalinker genereerib sertifikaadid `openssl` käsu abil. Linux/Unix põhistes süsteemides on `openssl` reeglina vaikimisi installitud, kuid Windowsis ei ole. Seega Pangalinker kasutamiseks kontrolli, et OpenSSL oleks installitud ja Node.js jaoks saadaval, vastasel korral ei ole võimalik genereerida serte ja teenus ei hakka korralikult tööle.

## Konfiguratsioon

Muuda faili `config/default.js` väärtusi või või lisa NODE_ENV väärtuse nimega täiendav fail. Lisakonfiguratsioonifailid täiendavad, mitte ei asenda vaikimisi seadeid.

Näiteks kui tahad, et konfiguratsioon laetaks failidest *default.js* + *production.js*, käivita rakendus järgmiselt:

    NODE_ENV=production node index.js

## Käivitamine

    node index.js

Juhul kui veebiliides kasutab porti 80 või 443, pead käivitama rakenduse juurkasutaja õigustes.
