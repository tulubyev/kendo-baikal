# Шаблоны темы (структура)

Автоматически составлено из PHP/HTML-шаблонов. ⟨…⟩ — динамические вставки WordPress (меню, контент, виджеты). PHP-код не копируется.

## ink-and-wash/404.php

Подключает: include:header, include:sidebar, include:footer

```
⟨include:header⟩
<div.narrowcolumn#content>
  <div.content_top.conleft>
  <div.content_foot.conleft>
⟨include:sidebar⟩
⟨include:footer⟩
```

## ink-and-wash/archive.php

Подключает: include:header, include:sidebar, include:footer

Вставки: loop, date, title, taxonomy, content

```
⟨include:header⟩
<div.narrowcolumn#content>
  <div.content_top.conleft>
  ⟨loop⟩
  ⟨date⟩
  <h2.pagetitle>
  ⟨loop⟩
  <h2>
    ⟨title⟩
  <div.post_intro>
    ⟨taxonomy⟩
    ⟨taxonomy⟩
  <div.content_date>
    <div.datebg>
      ⟨date⟩
      ⟨date⟩
      ⟨date⟩
  <div.comments>
  <div.entry>
    ⟨content⟩
  <div.nofound>
  <div.content_foot.conleft>
⟨include:sidebar⟩
⟨include:footer⟩
```

## ink-and-wash/footer.php

```
<div.clear#footer>
  <div.wrap>
```

## ink-and-wash/header.php

Вставки: site-info

```
<div#fullwrapper>
  <div.wrap>
    <div.header>
      <div.logo>
        ⟨site-info⟩
        ⟨site-info⟩
      <ul.nav>
  <div.wrap>
```

## ink-and-wash/index.php

Подключает: include:header, include:sidebar, include:footer

Вставки: loop, title, taxonomy, date, content

```
⟨include:header⟩
<div#content>
  <div.content_top.conleft>
  ⟨loop⟩
  ⟨loop⟩
  <div#post->
    <h2>
      ⟨title⟩
    <div.post_intro>
      ⟨taxonomy⟩
      ⟨taxonomy⟩
    <div.content_date>
      <div.datebg>
        ⟨date⟩
        ⟨date⟩
        ⟨date⟩
    <div.comments>
    <div.entry>
      ⟨content⟩
  <div.nofound>
  <div.content_foot.conleft>
⟨include:sidebar⟩
⟨include:footer⟩
```

## ink-and-wash/page.php

Подключает: include:header, include:sidebar, include:footer

Вставки: loop, title, content, date, comments

```
⟨include:header⟩
<div.narrowcolumn#content>
  <div.content_top.conleft>
  ⟨loop⟩
  <div.post#post->
    <h2>
      ⟨title⟩
    <div.entry>
      ⟨content⟩
    <div.content_date>
      <div.datebg>
        ⟨date⟩
        ⟨date⟩
        ⟨date⟩
    <div.pageedit>
  ⟨comments⟩
  <div.content_foot.conleft>
⟨include:sidebar⟩
⟨include:footer⟩
```

## ink-and-wash/search.php

Подключает: include:header, include:sidebar, include:footer

Вставки: loop, title, taxonomy, date, content

```
⟨include:header⟩
<div.narrowcolumn#content>
  <div.content_top.conleft>
  ⟨loop⟩
  <h2.pagetitle>
  ⟨loop⟩
  <h2>
    ⟨title⟩
  <div.post_intro>
    ⟨taxonomy⟩
    ⟨taxonomy⟩
  <div.content_date>
    <div.datebg>
      ⟨date⟩
      ⟨date⟩
      ⟨date⟩
  <div.comments>
  <div.entry>
    ⟨content⟩
  <div.nofound>
  <div.content_foot.conleft>
⟨include:sidebar⟩
⟨include:footer⟩
```

## ink-and-wash/sidebar.php

Вставки: site-info

```
<div#sidebar>
  <div#search>
    <form#searchform>
  <div.clear>
  <ul>
```

## ink-and-wash/single.php

Подключает: include:header, include:sidebar, include:footer

Вставки: loop, title, taxonomy, date, content, comments

```
⟨include:header⟩
<div.widecolumn#content>
  <div.content_top.conleft>
  ⟨loop⟩
  <div#post->
    <h2>
      ⟨title⟩
    <div.post_intro>
      ⟨taxonomy⟩
      ⟨taxonomy⟩
    <div.content_date>
      <div.datebg>
        ⟨date⟩
        ⟨date⟩
        ⟨date⟩
    <div.comments>
    <div.entry>
      ⟨content⟩
  ⟨comments⟩
  <div.content_foot.conleft>
⟨include:sidebar⟩
⟨include:footer⟩
```
