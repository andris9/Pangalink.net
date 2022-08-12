<div class="page-header">
  <h1>UI automaattestid</h1>
</div>

Pangalinker on automaattestisõbralik, kõik olulisemad väärtused on kirjeldatud `data-*` atribuutidega. UI automaatteste on võimalik läbi viia näiteks [Seleniumi](http://docs.seleniumhq.org/) abil.

### Makse staatus

Makse staatuse leiab järgmisest väljast:

    document.querySelector("[data-current-state]").dataset.paymentState

Võimalikud väärtused:

-   **preview** – ees on maksekorralduse või autentimise eelvaade
-   **payed** – maksekorraldus on aktsepteeritud ("tagasi kaupmehe juurde" leht)
-   **rejected** – maksekorraldus on tehnilistel põhjustel tagasi lükatud ("tagasi kaupmehe juurde" leht)
-   **cancelled** – maksekorraldus on kasutaja poolt katkestatud ("tagasi kaupmehe juurde" leht)
-   **authenticated** – kasutaja on autenditud ("tagasi kaupmehe juurde" leht)
-   **error** – makse andmeid ei aktsepteeritud, vt. ka `data-payment-error` välja

Juhul kui makse andmeid ei aktsepteeritud, leiab veateate kirjelduse teksti kujul järgmisest väljast:

    document.querySelector("[data-payment-error]").dataset.paymentError

Näiteks juhul kui makse on õnnestunud, peaks "tagasi kaupmehe juurde" lehel leiduma järgmine element:

    document.querySelector("[data-current-state=payed]")

### Makse nupud

Kõik nupud on märgistatud atribudiga `data-button`, mille väärtused on järgnevad:

-   **accept** – makse kinnitamise nupp (makse eelvaate lehel)
-   **cancel** – makse katkestamise nupp (makse eelvaate lehel)
-   **reject** – makse tagasilükkamise nupp (makse eelvaate lehel)
-   **return** – makse tagasilükkamise nupp ("tagasi kaupmehe juurde" leht)
-   **auth** – kasutaja autentimise nupp (autentimisvormi lehel)

NB! Kuna HTML elemendid võivad olla erinevad (nii &lt;A&gt; kui ka &lt;button&gt;), siis selektoris ei tohiks elemendi tüüpi määrata ja kasutada vaid `data-button` atribuuti. Näiteks makse aktsepteerimiseks võib teha nii:

    document.querySelector("[data-button=accept]").click()

### Makse väljad

Osadel juhtudel on võimalik muuta makse sooritaja nime ja kontonumbrit, need väljad leiab `data-input` atribuudi abil:

-   **sender-name** maksja nimi (makse eelvaate lehel)
-   **sender-account** maksja konto number (makse eelvaate lehel)
-   **auth-user** kasutaja kokkuleppeline identifikaator (autentmisvormi lehel)
-   **auth-user-name** kasutaja nimi (autentmisvormi lehel)
-   **auth-user-id** kasutaja isikukood (autentmisvormi lehel)
-   **auth-country** isikukoodi riik (autentmisvormi lehel)
-   **auth-other** muu info kasutaja kohta (autentmisvormi lehel)
-   **auth-token** autentimisvahend (autentmisvormi lehel)

Näide:

    document.querySelector("[data-input=sender-name]").value = "Foo Bar"

### Sisend- ja väljundandmed

Kõik POST sisendparameetrid leiab makse eelvaate lehel `data-in-key` atribuutide abil, kus `data-in-key` väärtuseks on POST parameetri võti ning samas elemendis asuv `data-in-value` sisaldab selle parameetri väärtust.

Kõik väljundparameetrid leiab "tagasi kaupmehe juurde" lehelt `data-out-key` ja `data-out-value` atribuutide abil.

Näiteks `VK_MSG` väärtuse sisendamete hulgast leiab makse eelvaate lehel järgmise päringuga:

    document.querySelector("[data-in-key=VK_MSG]").dataset.inValue

Sarnaselt leiab "tagasi kaupmehe juurde" lehelt väljuvate andmete väärtusi:

    document.querySelector("[data-out-key=VK_MSG]").dataset.outValue
