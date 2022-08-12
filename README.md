# NB!

**This software is provided "AS IS". No further development, no bug fixes, no support.** If you like this software then you are free to use it, do not contact the developers regarding issues with usage / installation / possible bugs etc. you will not be answered.

# Pangalinker

## Eeldused

-   [Node.js](http://nodejs.org/), vähemalt versioon 8.0.0 (6 võib aga ei pruugi töötada)
-   [MongoDB](http://www.mongodb.org/)
-   OpenSSL käsurea utiliit. Linux põhistes süsteemides reeglina vaikimisi olemas, Windowsis tuleb see ise [paigaldada](https://blog.didierstevens.com/2015/03/30/howto-make-your-own-cert-with-openssl-on-windows/)

## Kiirpaigaldus

Pangalinkerit on võimalik kiirpaigaldada tühja Ubuntu 20.04 operatsioonisüsteemiga serverisse (testitud DigitalOcean Ubuntu 20.04 VPS serveril). "Tühja" selles mõttes, et sinna pole veel paigaldatud muud tarkvara. Juhul kui rakenduse failid on kopeeritud serverisse, tuleks rakenduse kaustas käivitada järgmine käsk:

    sudo ./setup/ubuntu-install.sh

Paigaldusskript paigaldab ja konfigureerib järgmised tarkvarad:

-   MongoDB
-   Node.js
-   Pangalinkeri rakendus (failid kopeeritakse süsteemsesse kausta)

Paigaldusskript kasutab seadistusteks serveri avalikult tuletatavat domeeninime.

Parimal juhul ei olegi vaja midagi rohkemat seadistada ning võib avada rakenduse veebilehe. Vaikimisi jookseb selliselt paigaldatud rakendus üle HTTP ning seega tasub kaaluda võimalusi rakenduse seadistamiseks nii, et see kasutaks HTTPS protkolli.

## Windowsi kasutajatele

Pangalinker genereerib sertifikaadid `openssl` käsu abil. Linux/Unix põhistes süsteemides on `openssl` reeglina vaikimisi installitud, kuid Windowsis ei ole. Seega Pangalinker kasutamiseks kontrolli, et OpenSSL oleks installitud ja Node.js jaoks saadaval, vastasel korral ei ole võimalik genereerida serte ja teenus ei hakka korralikult tööle.

## Nginx / Apache jmt

Juhul kui samas serveris serveerib veebiporte juba Apache või Nginx vmt veebiserveri rakendus, siis Pangalinker otse veebi serveerimisega tegeleda ei saa. Lahenduseks oleks sellisel juhul

1.  Kas kasutada mittestandardset porti. http://example.com/ asemel näiteks http://example.com:3000/
2.  Või seadistada peamine veebiserver proksima Pangalinkeri päringuid. Näidisseadistused Apache ja Nginx jaoks leiab setup/virtual-hosts kaustast.

## Docker

```
$ docker pull andris9/pangalink:latest
$ docker run -dp 3480:3480 --env PL_MONGO_URL="mongodb://host.docker.internal:27017/pangalink" andris9/pangalink:latest
```

## Käivitamine

Rakenduse kaustas:

    node index.js

Juhul kui veebiliides kasutab porti 80 või 443, pead käivitama rakenduse juurkasutaja õigustes.

## Konfiguratsioon

Konfiguratsiooni saab ette anda keskkonnamuutujatega.

**Andmebaas**

-   `PL_MONGO_URL` – andmebaasi URL, vaikimisi _"mongodb://127.0.0.1:27017/pangalink"_

**Veebiserver**

-   `PL_PORT` – millist porti kuulata, vaikimisi _3480_
-   `PL_HOST` – millist ip aadressi kuulata, vaikimisi _"127.0.0.1"_. Kogu maailmale avamiseks kasuta _"0.0.0.0"_
-   `PL_SESSION_SECRET` – sessiooni küpsise parool

**Lingid**

Mõngingatel juhtudel on rakendusel vaja genereerida absoluutseid veebiaadresse. Domeeni ja protokolli määramiseks kasutatakse järgmiseid väärtuseid.

-   `PL_HOSTNAME` – veebilehe domeeninimi, näiteks _"pangalink.example.com"_. Kasutatakse kliendi linkide genereerimisel.
-   `PL_PROTO` – veebiaadressi protokoll, näiteks _"https"_ (vaikimisi _"http"_). Kasutatakse kliendi linkide genereerimisel.

**Kirjade saatmine**

-   `PL_SMTP_DIRECT` – kas rakendus peaks saatma kirju otse saaja MX serverile (vaikimisi _"true"_). Selle seadistusega on suur tõenäosus, et kirjad lähevad spämmi või ei võeta üldse vastu.
-   `PL_SMTP_HOST` – kirjade saatmise SMTP server, näiteks _"smtp.gmail.com"_
-   `PL_SMTP_PORT` – kirjade saatmise SMTP serveri port, näiteks _465_
-   `PL_SMTP_TLS` – kas kirjade saatmise SMTP server kasutab TLS'i (_"true"_) või STARTTLS'i (_"false"_)
-   `PL_SMTP_USER` – kirjade saatmise SMTP serveri kasutajanimi
-   `PL_SMTP_PASS` – kirjade saatmise SMTP serveri parool
-   `PL_SMTP_SENDER` – kirjade saatmise kasutatv From aadress

### Andmebaasi seadistus

Juhul kui MongoDB andmebaas kasutab autentimist või on _replica set_ või shardingu konfiguatsioonis, siis sellega seotud andmed saab määrata andmebaasi URL'is, mille vormingu info [leiab siit](https://docs.mongodb.com/manual/reference/connection-string/)

### E-posti saatmine

E-posti saatmise võimalus ei ole otseselt vajalik, kuid kohati on see oluline. E-posti teel saadetakse parooli meeldetuletuse kirjad ning samuti aktiveerimislingid lisatud kasutajatele. Aktiveerimislingi leiab admin kasutaja ka Kasutajate lehelt, juhul kui vastav kiri kohale ei jõudnud.

E-posti saatmiseks peab jälgima, et konfiguratsioonifailis oleks korrektne saatja aadress ning et sellest serverist oleks lubatud selle aadressi kaudu kirju saata (SPF).

## Litsents

**[MIT](./LICENSE)**

### Kasutatud tarkvaramoodulid

Pangalinker kasutab oma tööks mitmeid teisi tarkvaramoodulid. Nende kõikide info leiab failist DEPENDENCIES. Seal on toodud ära iga alammooduli nimetus, autor, litsents ja litsentsifaili asukoht kataloogipuus.

Kõik tarkvaramoodulid kasutavad üht järgmistest litsentsidest: MIT, ISC, Apache-2.0 või BSD-3-Clause.
