# Pangalink.net

## Eeldused

  * [Node.js](http://nodejs.org/), vähemalt versioon 5.0.0
  * [MongoDB](http://www.mongodb.org/)
  * GIT (koodi alla laadimiseks ja uuendamiseks, pole otseselt vajalik)

## Install

    git clone git://github.com/andris9/Pangalink.net.git
    cd Pangalink.net
    npm install

## Windowsi kasutajatele

Pangalink.net genereerib sertifikaadid `openssl` käsu abil. *nix süsteemides on `openssl` reeglina vaikimisi installitud, kuid Windowsis ei ole. Seega Pangalink.net kasutamiseks kontrolli, et OpenSSL oleks installitud ja Node.js jaoks saadaval, vastasel korral ei ole võimalik genereerida serte ja teenus ei hakka korralikult tööle.

## Konfiguratsioon

Muuda faili `config/default.js` väärtusi või või lisa NODE_ENV väärtuse nimega täiendav fail. Lisakonfiguratsioonifailid täiendavad, mitte ei asenda vaikimisi seadeid.

Näiteks kui tahad, et konfiguratsioon laetaks failidest *default.js* + *production.js*, käivita rakendus järgmiselt:

    NODE_ENV=production node index.js

## Käivitamine

    node index.json

Juhul kui veebiliides kasutab porti 80 või 443, pead käivitama rakenduse juurkasutaja kasutaja õigustes.

## Litsents

**MIT**
