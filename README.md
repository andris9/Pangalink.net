# Pangalinker

## Eeldused

-   [Node.js](http://nodejs.org/), vähemalt versioon 8.0.0
-   [MongoDB](http://www.mongodb.org/)
-   OpenSSL käsurea utiliit. Linux põhistes süsteemides reeglina vaikimisi olemas, Windowsis tuleb see ise [paigaldada](https://blog.didierstevens.com/2015/03/30/howto-make-your-own-cert-with-openssl-on-windows/)

## Kiirpaigaldus

Pangalinkerit on võimalik kiirpaigaldada tühja Ubuntu 16.04 operatsioonisüsteemiga serverisse. "Tühja" selles mõttes, et sinna pole veel paigaldatud muud tarkvara. Juhul kui rakenduse failid on kopeeritud serverisse, tuleks rakenduse kaustas käivitada järgmine käsk:

    sudo ./setup/ubuntu-install.sh hostname

Kus

-   **hostname** on siis serveri nimi või IP

Paigaldusskript paigaldab ja konfigureerib järgmised tarkvarad:

-   MongoDB
-   Node.js
-   Pangalinkeri rakendus (failid kopeeritakse süsteemsesse kausta)

Parimal juhul ei olegi vaja midagi rohkemat seadistada ning võib avada rakenduse veebilehe. Vaikimisi jookseb selliselt paigaldatud rakendus üle HTTP ning seega tasub kaaluda võimalusi rakenduse seadistamiseks nii, et see kasutaks HTTPS protkolli.

## Windowsi kasutajatele

Pangalinker genereerib sertifikaadid `openssl` käsu abil. Linux/Unix põhistes süsteemides on `openssl` reeglina vaikimisi installitud, kuid Windowsis ei ole. Seega Pangalinker kasutamiseks kontrolli, et OpenSSL oleks installitud ja Node.js jaoks saadaval, vastasel korral ei ole võimalik genereerida serte ja teenus ei hakka korralikult tööle.

## Käivitamine

    node index.js

Juhul kui veebiliides kasutab porti 80 või 443, pead käivitama rakenduse juurkasutaja õigustes.

## Konfiguratsioon

Muuda faili `config/default.js` väärtusi või või lisa NODE_ENV väärtuse nimega täiendav fail. Lisakonfiguratsioonifailid täiendavad, mitte ei asenda vaikimisi seadeid.

Näiteks kui tahad, et konfiguratsioon laetaks failidest _default.js_ + _production.js_, käivita rakendus järgmiselt:

    NODE_ENV=production node index.js

## Litsents

**[MIT](./LICENSE)**
