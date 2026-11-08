/* Selbsteinschätzung mündliche Leistung
 * Wolfgang Schneider, Lizenz CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/deed.de).
 
 *Wichtiger Hinweis! 
 * Sichtbarkeit: Die Datenbank braucht die Einstellung „Freigabe erforderlich: Ja“.
 * Einträge der Schüler nie freigeben. Der Einstellungseintrag der Lehrkraft ist freigegeben, damit alle ihn lesen.
 */
(function () {
/* Erzeugt aus einem Editor-Projekt die Dateien eines Moodle-Datenbank-Presets.
 *
 *   SE.erzeugen(projekt, bausteine) -> { 'preset.xml': '…', 'addtemplate.html': '…', … }
 *   SE.zip(dateien)                 -> Uint8Array (ZIP ohne Komprimierung, wie Moodle es lesen kann)
 *   SE.pruefen(projekt)             -> { fehler: [...], warnungen: [...] }
 *   SE.projektAusSkript(jstemplate) -> Projekt oder null (Wiederöffnen eines erzeugten Presets)
 *
 * bausteine = { kern, design, suche }: Inhalt von kern.js, design.css und suchvorlage.html
 */
var SE = (function () {
  'use strict';

  var FORMAT = 'selbsteinschaetzung-editor';
  var RESERVIERT = ['Fach', 'Halbjahr', 'Erwartung', 'Beispiel', 'Vorsatz'];
  // Texte, die nur in den HTML-Vorlagen gebraucht werden, nicht im Skript
  var NUR_HTML = ['titelEingabe', 'infoEingabe', 'infoListe', 'abweichungTitel'];

  var MASSSTAEBE = {
    normal: { name: 'normal (geradlinig)', k: 1 },
    streng: { name: 'streng', k: 1.25 },
    sehrstreng: { name: 'sehr streng', k: 1.5 }
  };
  var MODI = {
    punkte: { name: 'Punkte 0–15 (Oberstufe)' },
    tendenz: { name: 'Noten mit Tendenz (1, 1−, 2+ … 6)' },
    ganz: { name: 'Ganze Noten (1–6)' }
  };

  /* ---------- Noten ---------- */
  function grade(p) { return p >= 13 ? 1 : p >= 10 ? 2 : p >= 7 ? 3 : p >= 4 ? 4 : p >= 1 ? 5 : 6; }
  function noteLabel(p) {
    var g = grade(p);
    if (g === 6) { return '6'; }
    var pos = (p - 1) % 3;
    return String(g) + (pos === 2 ? '+' : pos === 0 ? '−' : '');
  }
  // Notenskala, von der besten zur schlechtesten.
  function stufenListe(modus) {
    var l = [], p;
    if (modus === 'punkte') { for (p = 15; p >= 0; p--) { l.push({ label: String(p), punkte: p }); } }
    else if (modus === 'tendenz') { for (p = 14; p >= 0; p--) { l.push({ label: noteLabel(p), punkte: p === 14 ? 15 : p }); } }
    else { [1, 2, 3, 4, 5, 6].forEach(function (g) { l.push({ label: String(g), punkte: [15, 12, 9, 6, 3, 0][g - 1] }); }); }
    return l;
  }
  // Zuordnung Stufe - Punktwert
  function stufeVon(modus, punkte) {
    if (modus === 'punkte') { return String(punkte); }
    if (modus === 'tendenz') { return noteLabel(Math.min(punkte, 14)); }
    return String(grade(punkte));
  }
  function erwartungOptionen(modus) { return stufenListe(modus).map(function (s) { return s.label; }); }

  /* ---------- Hilfen ---------- */
  function h(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function hAttr(s) { return h(s).replace(/"/g, '&quot;').replace(/'/g, '&#x27;'); }
  
  function x(s) {
    var out = '';
    Array.from(h(s)).forEach(function (c) {
      var cp = c.codePointAt(0);
      out += cp < 128 ? c : '&#x' + cp.toString(16).toUpperCase() + ';';
    });
    return out;
  }
  function alleItems(p) {
    var l = [];
    p.bereiche.forEach(function (b) { b.items.forEach(function (it) { l.push({ b: b, it: it }); }); });
    return l;
  }
  // Reflexionsfelder, die nicht entfernt sind
  function reflexion(p) { return ['Beispiel', 'Vorsatz'].filter(function (k) { return !(p.felder[k] && p.felder[k].aus); }); }
  function skalaVon(p, id) { return p.skalen.filter(function (s) { return s.id === id; })[0]; }

  /* Rasterzeile: Jede Stufe ist eine Beschreibung, die zu einer Note gehört (it.raster[0] = Note 1 … it.raster[5] = Note 6). */
  var RASTER_PUNKTE = [14, 11, 8, 5, 2, 0];
  function istRaster(it) { return Array.isArray(it.raster); }
  function rasterStufen(it) {
    var l = [];
    it.raster.forEach(function (t, i) { t = String(t || '').replace(/\s+/g, ' ').trim(); if (t) { l.push({ note: i + 1, text: t }); } });
    return l;
  }
  // Skala einer Frage
  function skalaFuer(p, it) {
    if (!istRaster(it)) { return skalaVon(p, it.skala); }
    var st = rasterStufen(it).reverse(), niedrig = -1;
    st.forEach(function (x, k) { if (x.note >= 4) { niedrig = k; } });
    return {
      id: 'raster:' + it.code, name: 'Rasterzeile ' + it.code, raster: true,
      stufen: st.map(function (x) { return x.text; }), noten: st.map(function (x) { return x.note; }),
      werte: st.map(function (x) { return RASTER_PUNKTE[x.note - 1] / 15 * 4; }),
      niedrig: niedrig, anzeige: 'absteigend', darstellung: 'untereinander'
    };
  }
  function anzeigeStufen(s) { return s.anzeige === 'absteigend' ? s.stufen.slice().reverse() : s.stufen.slice(); }

  /* ---------- Prüfen ---------- */
  function pruefen(p) {
    var fehler = [], warn = [];
    if (!p || p.format !== FORMAT) { return { fehler: ['Keine Projektdatei dieses Editors.'], warnungen: [] }; }
    if (!MODI[p.modus]) { fehler.push('Unbekannte Notenskala.'); }
    if (!p.bereiche.length) { fehler.push('Es gibt keinen Bereich.'); }
    var codes = {};
    RESERVIERT.forEach(function (n) { codes[n.toLowerCase()] = 'reserviert'; });
    var ids = {};
    p.skalen.forEach(function (s) {
      if (ids[s.id]) { fehler.push('Die Skalen-ID „' + s.id + '“ kommt doppelt vor.'); }
      ids[s.id] = true;
      if (s.stufen.length < 2) { fehler.push('Die Skala „' + s.name + '“ braucht mindestens zwei Stufen.'); }
      var seen = {};
      s.stufen.forEach(function (st) {
        var k = st.trim().replace(/\s+/g, ' ').toLowerCase();
        if (!k) { fehler.push('Die Skala „' + s.name + '“ hat eine leere Stufe.'); }
        else if (seen[k]) { fehler.push('In der Skala „' + s.name + '“ kommt „' + st + '“ doppelt vor. Moodle speichert nur den Text, die Stufen müssen sich unterscheiden.'); }
        seen[k] = true;
      });
      if (s.niedrig < -1 || s.niedrig >= s.stufen.length) { fehler.push('Bei der Skala „' + s.name + '“ ist „niedrig bis Stufe“ ungültig.'); }
    });
    var summe = 0;
    p.bereiche.forEach(function (b) {
      summe += Number(b.weight) || 0;
      if (!b.name.trim()) { fehler.push('Ein Bereich hat keinen Namen.'); }
      if (!b.items.length) { fehler.push('Der Bereich „' + b.name + '“ hat keine Frage.'); }
      if (!(Number(b.weight) > 0)) { fehler.push('Der Bereich „' + b.name + '“ braucht ein Gewicht über 0.'); }
      if (!b.tips.length) { warn.push('Der Bereich „' + b.name + '“ hat keine Tipps. Als Entwicklungsfeld erscheint er dann ohne Tipps.'); }
      b.items.forEach(function (it) {
        var k = String(it.code).toLowerCase();
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(it.code)) { fehler.push('Der Fragecode „' + it.code + '“ ist ungültig (nur Buchstaben, Ziffern, Unterstrich).'); }
        else if (codes[k] === 'reserviert') { fehler.push('Der Fragecode „' + it.code + '“ ist schon für ein anderes Feld vergeben.'); }
        else if (codes[k]) { fehler.push('Der Fragecode „' + it.code + '“ kommt doppelt vor.'); }
        codes[k] = true;
        if (!it.text.trim()) { fehler.push('Die Frage ' + it.code + ' hat keinen Text.'); }
        if (istRaster(it)) {
          var rs = rasterStufen(it), gesehen = {};
          if (rs.length < 2) { fehler.push('Die Rasterzeile ' + it.code + ' braucht Beschreibungen für mindestens zwei Noten.'); }
          rs.forEach(function (x) {
            var k = x.text.toLowerCase();
            if (gesehen[k]) { fehler.push('In der Rasterzeile ' + it.code + ' steht dieselbe Beschreibung bei Note ' + gesehen[k] + ' und Note ' + x.note + '. Die Beschreibungen müssen sich unterscheiden.'); }
            gesehen[k] = x.note;
          });
          if (it.grenzen) { fehler.push('Die Rasterzeile ' + it.code + ' kann keine Obergrenze haben.'); }
          return;
        }
        var s = skalaVon(p, it.skala);
        if (!s) { fehler.push('Die Frage ' + it.code + ' hat keine gültige Skala.'); }
        else if (it.grenzen && it.grenzen.length !== s.stufen.length) { fehler.push('Bei ' + it.code + ' passen die Obergrenzen nicht zur Zahl der Stufen.'); }
        else if (s.nurLeitfrage && !it.grenzen) { warn.push('Die Frage ' + it.code + ' nutzt die Skala „' + s.name + '“. Sie ist nur für Fragen mit Obergrenze gedacht, ihre Stufen passen wahrscheinlich nicht zur Frage.'); }
      });
    });
    if (p.massstab && !MASSSTAEBE[p.massstab]) { fehler.push('Unbekannter Maßstab.'); }
    if (p.farbschema === 'eigen' && !rgb(p.farbe)) { fehler.push('Für das Farbschema „Eigene Grundfarbe“ fehlt eine gültige Farbe.'); }
    else if (kontrastWeiss(grundfarbe(p)) < 4.5) {
      warn.push('Weiße Schrift auf der Grundfarbe ist schlecht lesbar (Kontrast ' + kontrastWeiss(grundfarbe(p)).toFixed(1).replace('.', ',') + ' : 1, empfohlen mindestens 4,5 : 1). Eine dunklere Farbe wählen.');
    }
    if (summe !== 100) { warn.push('Die Gewichte ergeben ' + summe + ' statt 100. Gerechnet wird trotzdem richtig (anteilig).'); }
    ['Fach', 'Halbjahr'].forEach(function (n) {
      var o = p.felder[n].optionen || [];
      if (!o.length) { fehler.push('Das Feld „' + p.felder[n].label + '“ braucht mindestens eine Auswahl.'); }
      var seen = {};
      o.forEach(function (v) { if (seen[v]) { fehler.push('Im Feld „' + p.felder[n].label + '“ kommt „' + v + '“ doppelt vor.'); } seen[v] = true; });
    });
    [1, 2, 3, 4, 5, 6].forEach(function (g) {
      var n = p.noten[String(g)];
      if (!n || !n.word || !n.bogen) { warn.push('Für die Note ' + g + ' fehlt ein Text.'); }
    });
    return { fehler: fehler, warnungen: warn };
  }

  /* ---------- preset.xml ---------- */
  function feldXml(name, typ, beschreibung, pflicht, optionen) {
    var z = ['<field>', '<type>' + typ + '</type>', '<name>' + name + '</name>',
      '<description>' + x(beschreibung) + '</description>', '<required>' + (pflicht ? 1 : 0) + '</required>'];
    if (optionen) { z.push('<param1>' + x(optionen.join('\n')) + '</param1>'); }
    if (typ === 'textarea') { z.push('<param2>60</param2>', '<param3>4</param3>'); }
    z.push('</field>');
    return z.join('\n');
  }
  function presetXml(p) {
    var F = p.felder;
    var teile = ['<?xml version="1.0"?>\n<preset>\n\n<description/>\n\n<settings>\n<intro>' + x(p.beschreibung) + '</intro>\n' +
      '<comments>' + (p.kommentare ? 1 : 0) + '</comments>\n<requiredentries>0</requiredentries>\n<requiredentriestoview>0</requiredentriestoview>\n' +
      '<maxentries>0</maxentries>\n<rssarticles>0</rssarticles>\n<approval>1</approval>\n<manageapproved>1</manageapproved>\n' +
      '<defaultsortdir>1</defaultsortdir>\n<defaultsort>0</defaultsort>\n</settings>'];
    teile.push(feldXml('Fach', 'radiobutton', F.Fach.beschreibung, true, F.Fach.optionen));
    teile.push(feldXml('Halbjahr', 'menu', F.Halbjahr.beschreibung, true, F.Halbjahr.optionen));
    teile.push(feldXml('Erwartung', 'menu', F.Erwartung.beschreibung, true, erwartungOptionen(p.modus)));
    alleItems(p).forEach(function (e) {
      teile.push(feldXml(e.it.code, 'radiobutton', e.it.text, true, anzeigeStufen(skalaFuer(p, e.it))));
    });
    reflexion(p).forEach(function (k) { teile.push(feldXml(k, 'textarea', F[k].beschreibung, false)); });
    return teile.join('\n\n') + '\n\n</preset>\n';
  }

  /* ---------- HTML-Vorlagen ---------- */
  var KOPF = '<meta charset="utf-8">\n\n';
  // Lizenzhinweis 
  var LIZENZ_KOMMENTAR = ' * Wolfgang Schneider, Lizenz CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/deed.de).\n' +
    ' * Weitergabe und Bearbeitung erlaubt mit Namensnennung und unter derselben Lizenz.\n';
  var TOPBAR = '<div class="sb-topbar"><a class="sb-back" href="LINK-ZUM-KURS">&#8592; Zurück zum Kurs</a></div>';

  function eingabe(p) {
    var T = p.texte, F = p.felder;
    var z = [KOPF + '<div class="sb-wrap sb-add">', TOPBAR,
      '<h2 class="sb-title">' + h(T.titelEingabe) + '</h2>',
      '<div class="sb-info">' + T.infoEingabe + '</div>',
      '<section class="sb-card"><h3><span class="sb-num">1</span> Rahmendaten</h3>',
      '<div class="sb-grid2"><div class="sb-field"><div class="sb-label">' + h(F.Fach.label) + '</div><div class="sb-scale sb-inline">[[Fach]]</div></div>',
      '<div class="sb-field"><div class="sb-label">' + h(F.Halbjahr.label) + '</div>[[Halbjahr]]</div></div>',
      '<div class="sb-field sb-expect"><div class="sb-label">' + h(F.Erwartung.label) + '</div>[[Erwartung]]<div class="sb-hint">' +
        h(F.Erwartung.hinweis) + '</div></div></section>'];
    p.bereiche.forEach(function (b, i) {
      z.push('<section class="sb-card" data-sb-dim="' + b.key + '"><h3><span class="sb-num">' + (i + 2) + '</span> ' + h(b.name) +
        '</h3><p class="sb-sub">' + h(b.frage) + '</p>');
      b.items.forEach(function (it) {
        var s = skalaFuer(p, it);
        var hint = it.hinweis ? '<span class="sb-hint">' + h(it.hinweis) + '</span>' : '';
        var art = s && s.darstellung === 'untereinander' ? 'sb-freq' : 'sb-inline';
        z.push('<div class="sb-item" data-sb-q="' + it.code + '"><p class="sb-qtext"><span class="sb-code">' + it.code + '</span><span>' +
          h(it.text) + hint + '</span></p><div class="sb-scale ' + art + '">[[' + it.code + ']]</div></div>');
      });
      z.push('</section>');
    });
    var refl = reflexion(p);
    if (refl.length) {
      z.push('<section class="sb-card"><h3><span class="sb-num">' + (p.bereiche.length + 2) + '</span> Reflexion <span class="sb-opt">freiwillig</span></h3>' +
        '<p class="sb-sub">' + (refl.length > 1 ? 'Beide Felder kannst du' : 'Das Feld kannst du') + ' auch nach der Rückmeldung noch ergänzen: Eintrag öffnen und bearbeiten.</p>' +
        refl.map(function (k) { return '<div class="sb-field"><div class="sb-label">' + h(F[k].label) + '</div>[[' + k + ']]</div>'; }).join('') + '</section>');
    }
    z.push('</div>');
    return z.join('\n') + '\n';
  }

  function einzel(p) {
    var T = p.texte, F = p.felder, tab = '';
    p.bereiche.forEach(function (b) {
      tab += '<tr class="sb-dimrow"><th colspan="3">' + h(b.name) + '</th></tr>';
      b.items.forEach(function (it) {
        tab += '<tr><td class="sb-code">' + it.code + '</td><td>' + h(it.text) + '</td><td class="sb-ans"><span data-sb-item="' +
          it.code + '">[[' + it.code + ']]</span></td></tr>';
      });
    });
    return [KOPF + '<div class="sb-wrap sb-entry" data-sb-status="##approvalstatusclass##">', TOPBAR,
      '<div class="sb-warn" hidden></div>',
      '<header class="sb-head"><div><h2 class="sb-title">' + h(T.titel) + '</h2><div class="sb-meta"><span>##userpicture## ##user##</span>' +
        '<span><span data-sb-item="Fach">[[Fach]]</span></span><span>[[Halbjahr]]</span><span>##timeadded##</span></div></div>' +
        '<div class="sb-actions">##edit## ##delete## ##disapprove##</div></header>',
      '<span class="sb-hidden" data-sb-item="Erwartung">[[Erwartung]]</span>',
      '<section class="sb-result" aria-live="polite"><p class="sb-noscript">Die Auswertung wird geladen …</p></section>',
      '<details class="sb-card sb-answers"><summary>Deine Angaben im Einzelnen</summary><table class="sb-table">' + tab + '</table></details>',
      reflexion(p).length ? '<section class="sb-card"><h3>Reflexion</h3>' + reflexion(p).map(function (k) {
        return '<div class="sb-field"><div class="sb-label">' + h(F[k].kurz) + '</div><div class="sb-text">[[' + k + ']]</div></div>';
      }).join('') + '</section>' : null,
      '<section class="sb-comments">##comments##</section>', '</div>'].filter(function (z) { return z !== null; }).join('\n') + '\n';
  }

  function liste(p) {
    var codes = alleItems(p).map(function (e) { return e.it.code; }).concat(reflexion(p));
    var spans = codes.map(function (k) { return '<span data-sb-item="' + k + '">[[' + k + ']]</span>'; }).join('');
    return '<tr class="sb-row" data-sb-status="##approvalstatusclass##">\n' +
      '<td class="sb-user" data-sb-col="user">##user##</td><td data-sb-col="fach">[[Fach]]</td>' +
      '<td data-sb-col="halbjahr">[[Halbjahr]]</td><td class="sb-date" data-sb-col="datum">##timeadded##</td>\n' +
      '<td class="sb-c"><span data-sb-item="Erwartung">[[Erwartung]]</span></td>\n' +
      '<td class="sb-c sb-res">–</td><td class="sb-c sb-diff">–</td>\n' +
      '<td class="sb-rowactions">##more## ##edit## ##delete## ##disapprove##<span class="sb-hidden">' +
      '<span class="sb-tmark">##approve##</span>' + spans + '</span></td>\n</tr>\n';
  }

  function listenkopf(p) {
    var T = p.texte;
    return KOPF + '<div class="sb-wrap sb-list">\n' + TOPBAR + '\n' +
      '<h2 class="sb-title">' + h(T.titel) + '</h2>\n' +
      '<div class="sb-warn sb-setupwarn" hidden></div>\n' +
      '<div class="sb-info sb-studentinfo">' + T.infoListe + '</div>\n' +
      '<div class="sb-teacherbar" hidden>\n' +
      '<div class="sb-tinfo"><strong>Lehreransicht:</strong> Hier stehen alle Einträge. Schüler sehen in dieser Liste nur ihre eigenen Einträge. Einträge daher nicht freigeben.</div>\n' +
      '<div class="sb-tools">\n' +
      '<button type="button" class="sb-btn" data-sb-action="print">&#128424; Liste drucken / als PDF</button>\n' +
      '<button type="button" class="sb-btn sb-btn-alt" data-sb-action="csv">&#8681; CSV-Datei (Excel)</button>\n' +
      (reflexion(p).length ? '<label class="sb-check"><input type="checkbox" class="sb-withtext"> Reflexionstexte mitdrucken</label>\n' : '') +
      '</div>\n' +
      '<p class="sb-pagehint" hidden>Gedruckt und exportiert werden nur die Einträge dieser Seite. Für alle Einträge in der Suche bei „Einträge pro Seite“ einen höheren Wert wählen.</p>\n' +
      '<p class="sb-tmsg" hidden></p>\n' +
      '</div>\n' +
      '<div class="sb-tablewrap"><table class="sb-table sb-overview"><thead><tr><th>Schüler</th><th>Fach</th><th>' + h(T.spalteHalbjahr) +
      '</th><th>Datum</th><th class="sb-c">Erwartung</th><th class="sb-c">Ergebnis</th><th class="sb-c" title="' + hAttr(T.abweichungTitel) +
      '">Abweichung</th><th></th></tr></thead><tbody>\n';
  }

  /* ---------- jstemplate.js ---------- */
  function einrueck(json) { return json.replace(/\n/g, '\n  '); }
  // Konfiguration der Auswertung (CFG in kern.js) aus einem Projekt
  function kernKonfig(p) {
    var texte = {};
    Object.keys(p.texte).forEach(function (k) { if (NUR_HTML.indexOf(k) < 0) { texte[k] = p.texte[k]; } });
    var skalen = {};
    p.skalen.forEach(function (s) { skalen[s.id] = { stufen: s.stufen, niedrig: s.niedrig }; });
    alleItems(p).forEach(function (e) {
      if (istRaster(e.it)) { var r = skalaFuer(p, e.it); skalen[r.id] = { stufen: r.stufen, niedrig: r.niedrig, werte: r.werte }; }
    });
    return {
      kursLink: p.kursLink,
      modus: p.modus,
      texte: texte,
      skalen: skalen,
      dims: p.bereiche.map(function (b) { return { key: b.key, name: b.name, short: b.short, weight: Number(b.weight), tips: b.tips }; }),
      items: alleItems(p).map(function (e) {
        var o = { code: e.it.code, dim: e.b.key, skala: istRaster(e.it) ? 'raster:' + e.it.code : e.it.skala, text: e.it.text };
        if (e.it.grenzen) { o.grenzen = e.it.grenzen; }
        return o;
      }),
      notes: p.noten,
      massstab: (MASSSTAEBE[p.massstab] || MASSSTAEBE.normal).k,
      reflexion: reflexion(p).map(function (k) { return { code: k, kurz: p.felder[k].kurz }; })
    };
  }
  function skript(p, kern) {
    var cfg = kernKonfig(p);
    var projekt = JSON.stringify(p).replace(/\*\//g, '*\\/');
    return '/* ' + p.texte.titel + ' – ' + MODI[p.modus].name + '\n' +
      LIZENZ_KOMMENTAR +
      ' * Erzeugt mit dem Editor für Selbsteinschätzungen (editor.html). Änderungen am besten dort vornehmen:\n' +
      ' * Diese Datei im Editor öffnen (Preset-ZIP oder jstemplate.js), ändern, neu erzeugen.\n' +
      ' *\n' +
      ' * Sichtbarkeit: Die Datenbank braucht die Einstellung „Freigabe erforderlich: Ja“.\n' +
      ' * Nicht freigegebene Einträge zeigt Moodle nur dem Autor und den Lehrern. Einträge daher nie freigeben.\n' +
      ' * Lehreransicht: Wer Einträge freigeben darf, bekommt in der Listenansicht Druck und CSV-Export.\n' +
      ' */\n' + kern.replace('/*@CFG@*/', einrueck(JSON.stringify(cfg, null, 2))) +
      '\n/*@PROJEKT ' + projekt + ' @PROJEKT*/\n';
  }
  function projektAusSkript(js) {
    var m = /\/\*@PROJEKT ([\s\S]*?) @PROJEKT\*\//.exec(String(js || ''));
    if (!m) { return null; }
    try { var p = JSON.parse(m[1]); return p && p.format === FORMAT ? p : null; } catch (e) { return null; }
  }

  function erzeugen(p, bausteine) {
    return {
      'preset.xml': presetXml(p),
      'addtemplate.html': eingabe(p),
      'singletemplate.html': einzel(p),
      'listtemplate.html': liste(p),
      'listtemplateheader.html': listenkopf(p),
      'listtemplatefooter.html': '</tbody></table></div></div>\n',
      'asearchtemplate.html': bausteine.suche,
      'rsstemplate.html': '',
      'rsstitletemplate.html': '',
      'csstemplate.css': farbTabelle(p) ? '/* Farbschema ' + (FARBSCHEMEN[p.farbschema] || {}).name + ' (Grundfarbe ' + grundfarbe(p) + ') */\n' + faerben(bausteine.design, p) : bausteine.design,
      'jstemplate.js': faerben(skript(p, bausteine.kern), p)
    };
  }

  /* ---------- Farbschemata ----------*/
  
  var TUERKIS = ['#0e7490', '#0b4f61', '#0b5568', '#67c6d9', '#e6f6f9', '#e6f4f7', '#cfe6ec', '#d5e2e6', '#f3fafb', '#fbfdfd',
    '#e6eef0', '#9cc7d1', '#f7fbfc', '#10333a', '#12313a', '#4b6b72', '#557079'];
  var TUERKIS_RGBA = ['rgba(14,116,144,', 'rgba(11,79,97,', 'rgba(16,51,58,'];
  // Blau: Grundfarbe RGB 0,192 · 0,416 · 0,737
  var BLAU = ['#316abc', '#234c87', '#275596', '#98b4dd', '#eaf0f8', '#eaf0f8', '#d2def0', '#d6e0ee', '#f5f8fc', '#fbfcfe',
    '#e7edf5', '#adc3e4', '#f6f9fc', '#142a47', '#142a47', '#4d607a', '#55667f'];
  var BLAU_RGBA = ['rgba(49,106,188,', 'rgba(35,76,135,', 'rgba(20,42,71,'];
  // Schwarz: Grautöne, Schaltflächen und Kopf fast schwarz
  var SCHWARZ = ['#1f1f1f', '#111111', '#000000', '#9a9a9a', '#f0f0f0', '#f0f0f0', '#d6d6d6', '#d9d9d9', '#f7f7f7', '#fcfcfc',
    '#e8e8e8', '#b5b5b5', '#f8f8f8', '#1a1a1a', '#1a1a1a', '#5c5c5c', '#666666'];
  var SCHWARZ_RGBA = ['rgba(31,31,31,', 'rgba(0,0,0,', 'rgba(26,26,26,'];
  // Wählbar sind Schwarz (Standard), Blau und eine eigene Grundfarbe. 
  var FARBSCHEMEN = {
    schwarz: { name: 'Schwarz (Standard)', grund: '#1f1f1f' },
    blau: { name: 'Blau', grund: '#316abc' },
    eigen: { name: 'Eigene Grundfarbe' }
  };
  function rgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) { return null; }
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hex(c) { return '#' + c.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function kontrastWeiss(hexFarbe) {
    var c = rgb(hexFarbe);
    if (!c) { return 0; }
    var l = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 1.05 / (0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2] + 0.05);
  }
  // Aus Grundfarbe abgeleitete Töne
  function abgeleitet(grund) {
    var c = rgb(grund);
    var dunkel = function (f) { return c.map(function (v) { return v * f; }); };
    var hell = function (t) { return c.map(function (v) { return 255 - t * (255 - v); }); };
    var grau = function (a, g) { return c.map(function (v, i) { return a * v + (1 - a) * g[i]; }); };
    var farben = [c, dunkel(0.72), dunkel(0.8), hell(0.5), hell(0.1), hell(0.1), hell(0.22), hell(0.18), hell(0.05), hell(0.02),
      hell(0.12), hell(0.4), hell(0.04), dunkel(0.4), dunkel(0.4), grau(0.3, [80, 92, 104]), grau(0.3, [90, 102, 114])].map(hex);
    var rgba = [c, dunkel(0.72), dunkel(0.4)].map(function (x) { return 'rgba(' + x.map(Math.round).join(',') + ','; });
    return { farben: farben, rgba: rgba };
  }
  function farbTabelle(p) {
    var s = p.farbschema;
    if (s === 'blau') { return { farben: BLAU, rgba: BLAU_RGBA }; }
    if (s === 'eigen' && rgb(p.farbe)) { return abgeleitet(p.farbe); }
    return { farben: SCHWARZ, rgba: SCHWARZ_RGBA };
  }
  function grundfarbe(p) { return p.farbschema === 'eigen' ? p.farbe : (FARBSCHEMEN[p.farbschema] || FARBSCHEMEN.schwarz).grund; }
  
  function faerben(text, p) {
    var t = farbTabelle(p);
    if (!t) { return text; }
    var alt = TUERKIS.concat(TUERKIS_RGBA), neu = t.farben.concat(t.rgba);
    return alt.reduce(function (s, a, i) { return s.split(a).join(neu[i]).split(a.toUpperCase()).join(neu[i]); }, text);
  }

  /* ---------- ZIP (ohne Komprimierung) ---------- */
  var CRC = (function () {
    var t = [], c, n, k;
    for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) { c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; } t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < b.length; i++) { c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(dateien) {
    var enc = new TextEncoder(), teile = [], zentral = [], pos = 0;
    var DOS_ZEIT = 0, DOS_DATUM = ((2026 - 1980) << 9) | (1 << 5) | 1;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    Object.keys(dateien).forEach(function (name) {
      var n = enc.encode(name), d = enc.encode(dateien[name]), c = crc32(d);
      var kopf = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(DOS_ZEIT), u16(DOS_DATUM),
        u32(c), u32(d.length), u32(d.length), u16(n.length), u16(0));
      teile.push(new Uint8Array(kopf), n, d);
      zentral.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(DOS_ZEIT), u16(DOS_DATUM),
        u32(c), u32(d.length), u32(d.length), u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(pos))), n);
      pos += kopf.length + n.length + d.length;
    });
    var zgroesse = zentral.reduce(function (s, b) { return s + b.length; }, 0);
    var ende = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(Object.keys(dateien).length),
      u16(Object.keys(dateien).length), u32(zgroesse), u32(pos), u16(0)));
    var alle = teile.concat(zentral, [ende]), laenge = alle.reduce(function (s, b) { return s + b.length; }, 0);
    var out = new Uint8Array(laenge), o = 0;
    alle.forEach(function (b) { out.set(b, o); o += b.length; });
    return out;
  }

  return {
    FORMAT: FORMAT, MODI: MODI, RESERVIERT: RESERVIERT,
    erzeugen: erzeugen, zip: zip, pruefen: pruefen, projektAusSkript: projektAusSkript, kernKonfig: kernKonfig,
    stufenListe: stufenListe, stufeVon: stufeVon, erwartungOptionen: erwartungOptionen, anzeigeStufen: anzeigeStufen,
    skalaFuer: skalaFuer, istRaster: istRaster, rasterStufen: rasterStufen, reflexion: reflexion,
    FARBSCHEMEN: FARBSCHEMEN, MASSSTAEBE: MASSSTAEBE, faerben: faerben, grundfarbe: grundfarbe, kontrastWeiss: kontrastWeiss
  };
})();
if (typeof module !== 'undefined') { module.exports = SE; }

/* Formular: Notenskala, Rahmendaten, Antwortskalen, Bereiche und Fragen, Notentexte, Texte.
 * 
 *   var F = SEFormular.erstellen(formElement, {
 *     basis: Projekt für fehlende Texte,
 *     moodle: true blendet aus, was nur beim Erzeugen eines Presets eine Rolle spielt,
 *     beiAenderung: function (projekt) {},   nach jeder Änderung
 *     status: function (html, fehler) {}     Meldungen an die Lehrkraft
 *   });
 *   F.laden(projekt) -> das bearbeitete Projekt (dasselbe Objekt wird später verändert)
 *   F.projekt(), F.pruefen() -> { fehler, warnungen }
 */
var SEFormular = (function () {
  'use strict';

  function $(s, r) { return (r || document).querySelector(s); }

  var SKALEN_VORLAGEN = [
    { id: 'haeufigkeit5', name: 'Häufigkeit (5 Stufen)', stufen: ['nie', 'selten', 'manchmal', 'oft', 'fast immer'] },
    { id: 'koennen4', name: 'Können (4 Stufen)', stufen: ['kann ich noch nicht', 'kann ich teilweise', 'kann ich meistens', 'kann ich sicher'] },
    { id: 'zustimmung4', name: 'Zustimmung ohne Mitte (4 Stufen)', stufen: ['trifft nicht zu', 'trifft eher nicht zu', 'trifft eher zu', 'trifft voll zu'] },
    { id: 'zustimmung5', name: 'Zustimmung (5 Stufen)', stufen: ['trifft nicht zu', 'trifft selten zu', 'trifft teilweise zu', 'trifft überwiegend zu', 'trifft voll zu'] },
    { id: 'eigene', name: 'Eigene Skala', stufen: ['niedrig', 'hoch'] }
  ];
  var TEXTE = [
    ['infoEingabe', 'Einleitung im Eingabeformular (HTML erlaubt)', '', 3],
    ['infoListe', 'Hinweis für Schüler über der Liste (HTML erlaubt)', '', 2],
    ['bogenTitel', 'Überschrift über dem Notentext', '', 1],
    ['kappung', 'Erklärung, wenn eine Obergrenze greift', '{raw} rechnerisches Ergebnis im Satz, {rawKurz} kurz, {freq} die gewählte Antwort, {cap} Obergrenze im Satz, {capKurz} kurz', 3],
    ['kappungEntwicklung', 'Entwicklungsfeld, wenn eine Obergrenze greift', '{bereich} Name des Bereichs', 1],
    ['kappungKurz', 'Kurzhinweis in der Liste, wenn eine Obergrenze greift', '', 1],
    ['vergleich', 'Vergleich mit der Erwartung: Einleitung', '{exp} spontane Erwartung im Satz', 1],
    ['vergleichPasst', '… wenn Erwartung und Ergebnis zusammenpassen', '', 1],
    ['vergleichHoeher', '… wenn die Erwartung besser war', '{n} Abstand, {res} Ergebnis kurz', 2],
    ['vergleichNiedriger', '… wenn die Erwartung schlechter war', '{n} Abstand, {res} Ergebnis kurz', 2],
    ['ansatzpunkte', 'Einleitung zu „Konkrete Ansatzpunkte“', '', 1],
    ['gleicheAntwort', 'Hinweis bei überall gleicher Antwort', '{antwort} die Antwort in Anführungszeichen', 2],
    ['abweichungTitel', 'Tooltip der Spalte „Abweichung“', '', 1],
    ['druckAbweichung', 'Fußnote im Druck zur Abweichung', '', 1],
    ['druckRechnerisch', 'Fußnote im Druck zu „rechn.“', '', 1],
    ['dateiname', 'Dateiname des CSV-Exports (ohne Datum)', '', 1]
  ];


  /* ---------- Hilfen ---------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function lines(s) { return String(s).split('\n').map(function (z) { return z.trim(); }).filter(Boolean); }

  function normalisieren(p, basis) {
    p.texte = p.texte || {};
    Object.keys(basis.texte).forEach(function (k) { if (typeof p.texte[k] !== 'string') { p.texte[k] = basis.texte[k]; } });
    ['Fach', 'Halbjahr', 'Erwartung', 'Beispiel', 'Vorsatz'].forEach(function (k) {
      p.felder[k] = Object.assign(clone(basis.felder[k]), p.felder[k] || {});
    });
    p.noten = p.noten || clone(basis.noten);
    p.kommentare = !!p.kommentare;
    if (!p.farbschema || (typeof SE !== 'undefined' && !SE.FARBSCHEMEN[p.farbschema])) { p.farbschema = basis.farbschema || 'schwarz'; }
    if (!p.massstab) { p.massstab = 'normal'; }
    if (p.farbschema === 'eigen' && !p.farbe) { p.farbe = '#316abc'; }
    p.bereiche.forEach(function (b) { b.tips = b.tips || []; b.frage = b.frage || ''; b.short = b.short || ''; });
    p.skalen.forEach(function (sk) {
      if (sk.nurLeitfrage !== undefined) { return; }
      var nutzer = [];
      p.bereiche.forEach(function (b) { b.items.forEach(function (it) { if (it.skala === sk.id && !Array.isArray(it.raster)) { nutzer.push(it); } }); });
      sk.nurLeitfrage = nutzer.length > 0 && nutzer.every(function (it) { return !!it.grenzen; });
    });
    return p;
  }

  /* Gewichte auf eine Summe verteilen, Verhältnisse erhalten, ganze Zahlen (größter Rest) */
  function aufSumme(gewichte, summe) {
    var alt = gewichte.reduce(function (a, g) { return a + (Number(g) > 0 ? Number(g) : 0); }, 0);
    var roh = gewichte.map(function (g) { return alt > 0 ? (Number(g) > 0 ? Number(g) : 0) / alt * summe : summe / gewichte.length; });
    var ganz = roh.map(Math.floor), rest = summe - ganz.reduce(function (a, g) { return a + g; }, 0);
    roh.map(function (r, i) { return { i: i, r: r - Math.floor(r) }; }).sort(function (a, b) { return b.r - a.r; })
      .slice(0, rest).forEach(function (x) { ganz[x.i] += 1; });
    return ganz;
  }

  function erstellen(form, opt) {
    opt = opt || {};
    var MOODLE = !!opt.moodle;
    var P = null, offen = { projekt: true, bereiche: true }, zu = {};
    function status(text, fehler) { if (opt.status) { opt.status(text, fehler); } }

    function teile(path) { return path.split('.').map(function (k) { return /^\d+$/.test(k) ? Number(k) : k; }); }
    function get(path) { return teile(path).reduce(function (o, k) { return o === undefined ? o : o[k]; }, P); }
    function set(path, v) {
      var t = teile(path), o = P;
      for (var i = 0; i < t.length - 1; i++) { o = o[t[i]]; }
      o[t[t.length - 1]] = v;
    }
    function skala(id) { return P.skalen.filter(function (s) { return s.id === id; })[0]; }
    function alleCodes() {
      var l = [];
      P.bereiche.forEach(function (b) { b.items.forEach(function (it) { l.push(it.code); }); });
      return l;
    }

    /* ---------- Formular ---------- */
    function feld(label, path, opt) {
      opt = opt || {};
      var v = get(path), attr = ' data-path="' + path + '"' + (opt.typ ? ' data-type="' + opt.typ + '"' : '') + (opt.neu ? ' data-rerender="1"' : '');
      var input;
      if (opt.zeilen) {
        var val = opt.typ === 'lines' ? (v || []).join('\n') : v;
        input = '<textarea rows="' + opt.zeilen + '"' + attr + '>' + esc(val) + '</textarea>';
      } else if (opt.auswahl) {
        input = '<select' + attr + '>' + opt.auswahl.map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select>';
      } else {
        input = '<input type="' + (opt.farbe ? 'color' : opt.typ === 'number' ? 'number' : 'text') + '" value="' + esc(v) + '"' + attr + '>';
      }
      return '<label class="f"><span>' + esc(label) + '</span>' + input + (opt.hilfe ? '<small>' + esc(opt.hilfe) + '</small>' : '') + '</label>';
    }
    // Einklappbare Karte (Bereich, Frage, Skala, Note). Bedienelemente stehen im Inhalt, nicht in der Zeile zum Klappen.
    function karte(id, kopf, inhalt, cls) {
      return '<details class="' + (cls || 'ed-card') + ' ed-klapp" data-klapp="' + esc(id) + '"' + (zu[id] ? '' : ' open') + '><summary class="ed-cardsum">' + kopf +
        '</summary><div class="ed-klappbody">' + inhalt + '</div></details>';
    }
    function kurz(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
    function abschnitt(id, titel, inhalt, badge) {
      return '<details class="ed-sec" data-sec="' + id + '"' + (offen[id] ? ' open' : '') + '><summary>' + esc(titel) +
        (badge ? '<span class="ed-badge">' + badge + '</span>' : '') + '</summary><div class="ed-body">' + inhalt + '</div></details>';
    }
    function knopf(text, action, daten, extra) {
      var d = Object.keys(daten || {}).map(function (k) { return ' data-' + k + '="' + daten[k] + '"'; }).join('');
      return '<button type="button" class="ed-mini' + (extra ? ' ' + extra : '') + '" data-action="' + action + '"' + d + '>' + text + '</button>';
    }

    function secProjekt() {
      var radios = Object.keys(SE.MODI).map(function (m) {
        return '<label><input type="radio" name="modus" value="' + m + '" data-path="modus" data-rerender="1"' + (P.modus === m ? ' checked' : '') + '> ' + esc(SE.MODI[m].name) + '</label>';
      }).join('');
      return abschnitt('projekt', MOODLE ? '1 Fach, Notenskala und Gestaltung' : '1 Projekt und Notenskala',
        (MOODLE ? feld('Fach oder Fächer dieses Kurses (eines pro Zeile)', 'felder.Fach.optionen', { zeilen: 2, typ: 'lines',
          hilfe: 'Trage hier dein Fach ein. Steht nur ein Fach hier, ist es für die Schüler fest eingestellt. Bei mehreren wählen die Schüler aus.' }) : '') +
        feld(MOODLE ? 'Name des Bogens (für den Export)' : 'Projektname (für Dateinamen)', 'name') +
        '<div class="f"><span>Notenskala</span><div class="ed-radios">' + radios + '</div></div>' +
        '<div class="ed-row">' + feld('Überschrift im Eingabeformular', 'texte.titelEingabe') + feld('Überschrift in Liste und Rückmeldung', 'texte.titel') + '</div>' +
        ('<div class="ed-row">' + feld('Farbschema', 'farbschema', { auswahl: Object.keys(SE.FARBSCHEMEN).map(function (k) { return [k, SE.FARBSCHEMEN[k].name]; }), neu: true }) +
        (P.farbschema === 'eigen' ? feld('Grundfarbe', 'farbe', { farbe: true, hilfe: 'Weiße Schrift muss darauf gut lesbar sein.' }) :
          '<div class="f"><span>Grundfarbe</span><span class="ed-farbmuster" style="background:' + esc(SE.grundfarbe(P)) + '"></span></div>') + '</div>') +
      feld('Maßstab', 'massstab', { auswahl: Object.keys(SE.MASSSTAEBE).map(function (k) { return [k, SE.MASSSTAEBE[k].name]; }),
        hilfe: 'Selbsteinschätzungen fallen meist zu gut aus. „Streng“ wertet Skalenantworten strenger aus: Wer überall die zweithöchste von fünf Stufen wählt, ' +
          'bekommt 10 statt 11 Punkte, bei der mittleren Stufe 6 statt 8. Rasterzeilen sind schon an Noten gebunden und bleiben, wie sie sind. Standard ist „normal“.' }) +
      feld('Link zum Kurs', 'kursLink', { hilfe: 'Bleibt „LINK-ZUM-KURS“ stehen, sucht das Skript den Kurslink in der Moodle-Navigation.' }) +
        (MOODLE ? '' : feld('Beschreibung der Datenbank (HTML erlaubt)', 'beschreibung', { zeilen: 2, hilfe: 'Erscheint in Moodle über der Datenbank.' }) +
        '<label class="ed-check"><input type="checkbox" data-path="kommentare" data-type="bool"' + (P.kommentare ? ' checked' : '') +
        '> Kommentare einschalten (die Lehrkraft kann unter dem Eintrag antworten)</label>'));
    }

    function secRahmen() {
      return abschnitt('rahmen', '2 Rahmendaten',
        '<div class="ed-row">' + feld('Fächer: Überschrift', 'felder.Fach.label') + nurPreset(feld('Fächer: Beschreibung in Moodle', 'felder.Fach.beschreibung')) + '</div>' +
        (MOODLE ? '<p class="ed-note">Die Fächer stehen oben unter „1 Fach, Notenskala und Gestaltung“.</p>' : feld('Fächer (eines pro Zeile)', 'felder.Fach.optionen', { zeilen: 3, typ: 'lines' })) +
        '<div class="ed-row">' + feld('Halbjahr: Überschrift', 'felder.Halbjahr.label') + nurPreset(feld('Halbjahr: Beschreibung in Moodle', 'felder.Halbjahr.beschreibung')) +
        feld('Halbjahr: Spaltenname in der Liste', 'texte.spalteHalbjahr') + '</div>' +
        feld('Halbjahre (eines pro Zeile)', 'felder.Halbjahr.optionen', { zeilen: 4, typ: 'lines' }) +
        feld('Frage nach der spontanen Erwartung', 'felder.Erwartung.label') +
        '<div class="ed-row">' + feld('Hinweis darunter', 'felder.Erwartung.hinweis') + nurPreset(feld('Beschreibung in Moodle', 'felder.Erwartung.beschreibung')) + '</div>' +
        '<p class="ed-note">Auswahl bei der Erwartung, automatisch aus der Notenskala: ' + esc(SE.erwartungOptionen(P.modus).join(' · ')) + '</p>');
    }

    function secSkalen() {
      var genutzt = {};
      P.bereiche.forEach(function (b) { b.items.forEach(function (it) { if (!SE.istRaster(it)) { genutzt[it.skala] = (genutzt[it.skala] || 0) + 1; } }); });
      var html = '<p class="ed-note">Eine Skala sind die Antwortstufen einer Frage, von der niedrigsten zur höchsten. Jede Skala wird für die Auswertung auf 0 bis 100 % umgerechnet, ' +
        'deshalb lassen sich Skalen mit unterschiedlich vielen Stufen mischen.</p>';
      P.skalen.forEach(function (s, i) {
        var niedrig = [[-1, 'keine Stufe']].concat(s.stufen.map(function (st, k) { return [k, 'bis „' + st + '“']; }));
        html += karte('s:' + s.id, '<strong>' + esc(s.name) + '</strong><small>' + (genutzt[s.id] || 0) + ' Fragen · ' + esc(kurz(s.stufen.join(' · '), 60)) + '</small>',
          '<div class="ed-cardhead"><span class="ed-spacer"></span>' + knopf('✕ löschen', 'del-skala', { s: i }, 'ed-danger') + '</div>' +
          feld('Name', 'skalen.' + i + '.name') +
          feld('Stufen, von niedrig nach hoch (eine pro Zeile)', 'skalen.' + i + '.stufen', { zeilen: Math.max(3, s.stufen.length), typ: 'lines', neu: true }) +
          '<div class="ed-row">' +
          feld('Reihenfolge im Formular', 'skalen.' + i + '.anzeige', { auswahl: [['aufsteigend', 'niedrig zuerst'], ['absteigend', 'hoch zuerst']] }) +
          feld('Darstellung', 'skalen.' + i + '.darstellung', { auswahl: [['nebeneinander', 'nebeneinander'], ['untereinander', 'untereinander (lange Texte)']] }) +
          feld('Gilt als niedrig („Ansatzpunkt“)', 'skalen.' + i + '.niedrig', { auswahl: niedrig, typ: 'int' }) +
          '</div><label class="ed-check"><input type="checkbox" data-path="skalen.' + i + '.nurLeitfrage" data-type="bool" data-rerender="1"' + (s.nurLeitfrage ? ' checked' : '') +
          '> Nur für Fragen mit Obergrenze (Stufen gehören zu einer bestimmten Frage, wie bei der Meldehäufigkeit)</label>');
      });
      html += '<div class="ed-addrow"><select id="ed-skalenvorlage">' + SKALEN_VORLAGEN.map(function (v, i) {
        return '<option value="' + i + '">' + esc(v.name) + ': ' + esc(v.stufen.join(' · ')) + '</option>';
      }).join('') + '</select>' + knopf('+ Skala hinzufügen', 'add-skala') + '</div>';
      return abschnitt('skalen', '3 Antwortskalen', html, P.skalen.length + ' Skalen');
    }

    function grenzenHtml(bi, ii, it) {
      var s = skala(it.skala), html = '<div class="ed-grenzen">';
      var opts = SE.stufenListe(P.modus);
      for (var k = s.stufen.length - 1; k >= 0; k--) {
        var aktuell = SE.stufeVon(P.modus, it.grenzen[k]);
        html += '<span>bei „' + esc(s.stufen[k]) + '“ höchstens</span><select data-path="bereiche.' + bi + '.items.' + ii + '.grenzen.' + k + '" data-type="int">' +
          opts.map(function (o) { return '<option value="' + o.punkte + '"' + (o.label === aktuell ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') +
          '</select>';
      }
      return html + '</div>';
    }

    var RASTER = '__raster__';
    function antwortformHtml(bi, ii, it, formen) {
      var v = SE.istRaster(it) ? RASTER : it.skala;
      return '<label class="f"><span>Antwortform</span><select data-antwortform="1" data-b="' + bi + '" data-i="' + ii + '">' + formen.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></label>';
    }
    function rasterHtml(pfad, it) {
      var html = '<p class="ed-note">Eine Beschreibung je Note, so wie in einem Kriterienraster. Die Schüler sehen nur die Beschreibungen, nicht die Noten. ' +
        'Gewertet wird die Mitte des Notenbereichs (Note 1 = 14, 2 = 11, 3 = 8, 4 = 5, 5 = 2, 6 = 0 Punkte). Leer lassen, wenn es für eine Note keine Beschreibung geben soll.</p>';
      for (var g = 1; g <= 6; g++) {
        var w = P.noten[String(g)] ? ' (' + P.noten[String(g)].word + ')' : '';
        html += feld('Note ' + g + w, pfad + '.raster.' + (g - 1), { zeilen: 2, typ: 'einzeilig' });
      }
      return html;
    }

    function secBereiche() {
      var summe = P.bereiche.reduce(function (s, b) { return s + (Number(b.weight) || 0); }, 0);
      // Skalen nur für Fragen mit Obergrenze erscheinen nur dort (und bei Fragen, die sie schon nutzen)
      function antwortformen(it) {
        var l = P.skalen.filter(function (s) { return !s.nurLeitfrage || it.grenzen || it.skala === s.id; }).map(function (s) {
          return [s.id, s.name + (s.nurLeitfrage && !it.grenzen ? ' (nur für Fragen mit Obergrenze)' : '')];
        });
        return it.grenzen ? l : l.concat([[RASTER, 'Rasterzeile: eine Beschreibung je Note']]);
      }
      var html = '<p class="ed-note ed-w"><strong>Datenbank hat schon Einträge?</strong> Dann die Wortlaute der Antwortstufen nicht mehr ändern und keine Fragen löschen. ' +
        'Die Antworten werden über den Fragecode (A1, B2 …) und den Wortlaut der Stufe zugeordnet. Die Codes vergibt der Bogen selbst, sie bleiben fest. ' +
        'Texte der Fragen, Tipps und Gewichte darfst du jederzeit ändern.</p>' +
        '<p class="ed-note">Summe der Gewichte: <span class="ed-sum" id="ed-wsum"></span> ' + knopf('auf 100 % ausgleichen', 'gewichte-100', {}, 'ed-ausgleich') +
        '<br>Kommt ein Bereich hinzu oder fällt einer weg, passen sich die anderen Gewichte anteilig an.</p>';
      P.bereiche.forEach(function (b, bi) {
        var bh = '<div class="ed-cardhead"><span class="ed-spacer"></span>' +
          knopf('↑', 'up-b', { b: bi }) + knopf('↓', 'down-b', { b: bi }) + knopf('✕ Bereich löschen', 'del-b', { b: bi }, 'ed-danger') + '</div>' +
          '<div class="ed-row">' + feld('Name', 'bereiche.' + bi + '.name') + feld('Kurzname (Druck)', 'bereiche.' + bi + '.short') +
          feld('Gewicht in %', 'bereiche.' + bi + '.weight', { typ: 'number' }) + '</div>' +
          feld('Leitfrage unter der Überschrift', 'bereiche.' + bi + '.frage') +
          feld('Tipps beim Entwicklungsfeld (einer pro Zeile)', 'bereiche.' + bi + '.tips', { zeilen: 3, typ: 'lines' });
        b.items.forEach(function (it, ii) {
          var pfad = 'bereiche.' + bi + '.items.' + ii;
          var form = SE.istRaster(it) ? 'Rasterzeile' : ((skala(it.skala) || {}).name || '') + (it.grenzen ? ' · mit Obergrenze' : '');
          bh += karte('i:' + it.code, '<span class="ed-code">' + esc(it.code) + '</span><span class="ed-sumtext">' + esc(kurz(it.text, 70) || '(ohne Text)') + '</span><small>' + esc(form) + '</small>',
            '<div class="ed-itemhead"><span class="ed-key" title="Fragecode: ordnet die Antworten der Schüler dieser Frage zu. Er wird automatisch vergeben und bleibt fest.">' + esc(it.code) + '</span>' +
            '<span class="ed-spacer"></span>' + knopf('↑', 'up-i', { b: bi, i: ii }) + knopf('↓', 'down-i', { b: bi, i: ii }) +
            knopf('✕', 'del-i', { b: bi, i: ii }, 'ed-danger') + '</div>' +
            feld('Frage oder Aussage', pfad + '.text', { zeilen: 2 }) +
            '<div class="ed-row">' + feld('Hinweis darunter (freiwillig)', pfad + '.hinweis') +
            antwortformHtml(bi, ii, it, antwortformen(it)) + '</div>' +
            (SE.istRaster(it) ? rasterHtml(pfad, it) :
              '<label class="ed-check"><input type="checkbox" data-action="toggle-grenzen" data-b="' + bi + '" data-i="' + ii + '"' + (it.grenzen ? ' checked' : '') +
              '> Obergrenze für das Gesamtergebnis je Antwort (wie die Meldehäufigkeit)</label>' +
              (it.grenzen ? grenzenHtml(bi, ii, it) : '')), 'ed-item');
        });
        bh += knopf('+ Frage hinzufügen', 'add-i', { b: bi });
        html += karte('b:' + b.key, '<span class="ed-key">' + esc(b.key) + '</span><strong>' + esc(b.name) + '</strong><small>' + (Number(b.weight) || 0) + ' % · ' +
          b.items.length + (b.items.length === 1 ? ' Frage' : ' Fragen') + '</small>', bh);
      });
      html += knopf('+ Bereich hinzufügen', 'add-b');
      return abschnitt('bereiche', '4 Bereiche und Fragen', html, P.bereiche.length + ' Bereiche · ' + alleCodes().length + ' Fragen · Summe ' + summe + ' %');
    }

    function secNoten() {
      var html = '<p class="ed-note">Diese Texte erscheinen unter dem Ergebnis. Sie gelten für alle Notenskalen (bei Punkten für den Notenbereich).</p>';
      [1, 2, 3, 4, 5, 6].forEach(function (g) {
        var p = 'noten.' + g;
        var n = P.noten[String(g)] || {};
        html += karte('n:' + g, '<span class="ed-key">' + g + '</span><strong>' + esc(n.word || '') + '</strong><small>' + esc(kurz(n.bogen, 60)) + '</small>',
          '<div class="ed-row">' + feld('Bezeichnung', p + '.word') + '</div>' +
          feld('Amtliche Formulierung', p + '.nvo', { zeilen: 2 }) + feld('Beschreibung für Schüler', p + '.bogen', { zeilen: 3 }));
      });
      return abschnitt('noten', '5 Notentexte', html);
    }

    function secReflexion() {
      var aktiv = 0, html = '<p class="ed-note">Zwei freiwillige Textfelder nach den Fragen. Sie gehen nicht in das Ergebnis ein. Nicht gebrauchte Felder lassen sich entfernen.</p>';
      [['Beispiel', 1], ['Vorsatz', 2]].forEach(function (x) {
        var k = x[0], f = P.felder[k];
        if (f.aus) {
          html += '<div class="ed-card ed-aus"><div class="ed-cardhead"><strong>Feld ' + x[1] + ' entfernt</strong><small>' + esc(kurz(f.label, 70)) + '</small>' +
            knopf('+ wieder hinzufügen', 'refl-an', { f: k }) + '</div></div>';
          return;
        }
        aktiv++;
        html += karte('r:' + k, '<strong>Feld ' + x[1] + '</strong><small>' + esc(kurz(f.label, 70)) + '</small>',
          '<div class="ed-cardhead"><span class="ed-spacer"></span>' + knopf('✕ Feld entfernen', 'refl-aus', { f: k }, 'ed-danger') + '</div>' +
          feld('Frage im Formular', 'felder.' + k + '.label') + '<div class="ed-row">' + feld('Überschrift in der Rückmeldung', 'felder.' + k + '.kurz') +
          nurPreset(feld('Beschreibung in Moodle', 'felder.' + k + '.beschreibung')) + '</div>');
      });
      return abschnitt('reflexion', '6 Reflexion (freiwillige Textfelder)', html, aktiv === 2 ? '2 Felder' : aktiv === 1 ? '1 Feld' : 'keine');
    }

    function secTexte() {
      var html = '<p class="ed-note">Wörter in geschweiften Klammern werden beim Anzeigen ersetzt. Bitte so stehen lassen.</p>';
      TEXTE.forEach(function (t) {
        html += feld(t[1], 'texte.' + t[0], { zeilen: t[3] > 1 ? t[3] : 0, hilfe: t[2] ? 'Platzhalter: ' + t[2] : '' });
      });
      return abschnitt('texte', '7 Rückmeldetexte (für Fortgeschrittene)', html);
    }

    function nurPreset(html) { return MOODLE ? '' : html; }

    function render() {
      var y = window.scrollY;
      form.innerHTML = '<div id="ed-pruef"></div><div class="ed-klappleiste">' + knopf('▸ Alle einklappen', 'alle-zu') + knopf('▾ Alle ausklappen', 'alle-auf') + '</div>' + secProjekt() + secRahmen() + secSkalen() + secBereiche() + secNoten() + secReflexion() + secTexte();
      window.scrollTo(0, y);
      aktualisieren();
    }


    /* ---------- Prüfung ---------- */
    function pruefAnzeige() {
      var r = SE.pruefen(P), box = $('#ed-pruef', form);
      var summe = P.bereiche.reduce(function (s, b) { return s + (Number(b.weight) || 0); }, 0);
      var ws = $('#ed-wsum', form);
      if (ws) { ws.textContent = summe + ' %'; ws.className = 'ed-sum' + (summe !== 100 ? ' ed-bad' : ''); }
      var aus = $('.ed-ausgleich', form);
      if (aus) { aus.hidden = summe === 100; }
      if (!r.fehler.length && !r.warnungen.length) {
        box.innerHTML = '<p class="ed-note">✓ Keine Fehler gefunden. ' + (MOODLE ? 'Die Einstellungen können gespeichert werden.' : 'Das Preset kann erzeugt werden.') + '</p>';
      } else {
        box.innerHTML = '<div class="ed-card">' +
          (r.fehler.length ? '<strong>Fehler (' + (MOODLE ? 'vor dem Speichern' : 'vor dem Erzeugen') + ' beheben)</strong><ul class="ed-list ed-e">' + r.fehler.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' : '') +
          (r.warnungen.length ? '<strong>Hinweise</strong><ul class="ed-list ed-w">' + r.warnungen.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' : '') +
          '</div>';
      }
      return r;
    }
    function aktualisieren() {
      pruefAnzeige();
      if (opt.beiAenderung) { opt.beiAenderung(P); }
    }

    /* ---------- Eingaben ---------- */
    function wert(t) {
      var typ = t.dataset.type;
      if (typ === 'bool') { return t.checked; }
      if (typ === 'number') { return t.value === '' ? 0 : Number(t.value); }
      if (typ === 'int') { return parseInt(t.value, 10); }
      if (typ === 'lines') { return lines(t.value); }
      if (typ === 'einzeilig') { return t.value.replace(/\s+/g, ' '); }
      return t.value;
    }
    // Nach Änderungen an Skalen: Obergrenzen und „niedrig“ an die Zahl der Stufen anpassen
    function angleichen() {
      P.skalen.forEach(function (s) { if (s.niedrig >= s.stufen.length) { s.niedrig = s.stufen.length - 1; } });
      P.bereiche.forEach(function (b) {
        b.items.forEach(function (it) {
          if (SE.istRaster(it)) { delete it.grenzen; return; }
          var s = skala(it.skala);
          if (!s) { it.skala = P.skalen[0].id; s = P.skalen[0]; }
          if (it.grenzen) {
            while (it.grenzen.length < s.stufen.length) { it.grenzen.push(15); }
            it.grenzen.length = s.stufen.length;
          }
        });
      });
    }
    // Erste Skala, die zu einer Frage ohne Obergrenze passt
    function normaleSkala() { return (P.skalen.filter(function (s) { return !s.nurLeitfrage; })[0] || P.skalen[0]).id; }
    function antwortformWechsel(t) {
      var it = P.bereiche[Number(t.dataset.b)].items[Number(t.dataset.i)];
      if (t.value === RASTER) {
        it.raster = it.raster || ['', '', '', '', '', ''];
        delete it.skala;
        delete it.grenzen;
      } else {
        delete it.raster;
        it.skala = t.value;
        if (it.grenzen) { it.grenzen = skala(it.skala).stufen.map(function () { return 15; }); }
      }
      angleichen();
      render();
    }
    function eingabe(e, fertig) {
      var t = e.target;
      if (t.dataset && t.dataset.antwortform) { if (fertig) { antwortformWechsel(t); } return; }
      if (!t.dataset || !t.dataset.path) { return; }
      if (t.type === 'radio' && (!t.checked || !fertig)) { return; }
      var alt = get(t.dataset.path);
      set(t.dataset.path, wert(t));
      if (fertig && t.dataset.rerender) {
        if (t.dataset.path === 'farbschema' && P.farbschema === 'eigen' && !P.farbe) { P.farbe = '#316abc'; }
        if (t.dataset.path === 'modus' && alt !== P.modus) {
          status('Notenskala geändert. Prüfe in „Rahmendaten“ die Frage zur Erwartung und in „Rückmeldetexte“ Wörter wie „Punkte“ oder „Note“.');
        }
        if (/\.skala$/.test(t.dataset.path)) {
          var it = get(t.dataset.path.replace(/\.skala$/, ''));
          if (it.grenzen) { it.grenzen = skala(it.skala).stufen.map(function () { return 15; }); }
        }
        angleichen();
        render();
        return;
      }
      aktualisieren();
    }
    form.addEventListener('input', function (e) { eingabe(e, false); });
    form.addEventListener('change', function (e) { eingabe(e, true); });
    form.addEventListener('toggle', function (e) {
      if (e.target.dataset && e.target.dataset.sec) { offen[e.target.dataset.sec] = e.target.open; }
      if (e.target.dataset && e.target.dataset.klapp) { zu[e.target.dataset.klapp] = !e.target.open; }
    }, true);
    function alleKlappen(auf) {
      form.querySelectorAll('details').forEach(function (d) {
        d.open = auf;
        if (d.dataset.sec) { offen[d.dataset.sec] = auf; }
        if (d.dataset.klapp) { zu[d.dataset.klapp] = !auf; }
      });
    }

    function freierKey() {
      var used = P.bereiche.map(function (b) { return b.key; });
      for (var c = 65; c <= 90; c++) { if (used.indexOf(String.fromCharCode(c)) < 0) { return String.fromCharCode(c); } }
      return 'X' + used.length;
    }
    function freierCode(key) {
      var codes = alleCodes().map(function (c) { return c.toLowerCase(); }), n = 1;
      while (codes.indexOf((key + n).toLowerCase()) >= 0) { n++; }
      return key + n;
    }
    function gewichteMeldung() {
      status('Gewichte anteilig angepasst: ' + P.bereiche.map(function (x) { return x.key + ' ' + x.weight + ' %'; }).join(' · ') + '.');
    }
    function gewichteAnpassen() {
      if (!P.bereiche.length) { return; }
      aufSumme(P.bereiche.map(function (x) { return x.weight; }), 100).forEach(function (g, k) { P.bereiche[k].weight = g; });
      gewichteMeldung();
    }
    function tausch(arr, i, j) { if (j < 0 || j >= arr.length) { return; } var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }

    form.addEventListener('click', function (e) {
      var t = e.target.closest('[data-action]');
      if (!t) { return; }
      var a = t.dataset.action, bi = Number(t.dataset.b), ii = Number(t.dataset.i), b = P.bereiche[bi];
      if (a === 'toggle-grenzen') {
        var it = b.items[ii];
        if (t.checked) { it.grenzen = skala(it.skala).stufen.map(function () { return 15; }); } else { delete it.grenzen; }
      } else if (a === 'up-b') { tausch(P.bereiche, bi, bi - 1); }
      else if (a === 'down-b') { tausch(P.bereiche, bi, bi + 1); }
      else if (a === 'del-b') {
        if (!confirm('Bereich „' + b.name + '“ mit allen Fragen löschen?')) { return; }
        P.bereiche.splice(bi, 1);
        gewichteAnpassen();
      } else if (a === 'add-b') {
        var key = freierKey();
        var neu = P.bereiche.length ? Math.round(100 / (P.bereiche.length + 1)) : 100;
        aufSumme(P.bereiche.map(function (x) { return x.weight; }), 100 - neu).forEach(function (g, k) { P.bereiche[k].weight = g; });
        P.bereiche.push({ key: key, name: 'Neuer Bereich', short: 'Neu', weight: neu, frage: '', tips: [],
          items: [{ code: freierCode(key), text: '', skala: normaleSkala() }] });
        gewichteMeldung();
      } else if (a === 'alle-zu' || a === 'alle-auf') {
        alleKlappen(a === 'alle-auf');
        return;
      } else if (a === 'refl-aus' || a === 'refl-an') {
        if (a === 'refl-aus') { P.felder[t.dataset.f].aus = true; } else { delete P.felder[t.dataset.f].aus; }
      } else if (a === 'gewichte-100') {
        gewichteAnpassen();
      } else if (a === 'up-i') { tausch(b.items, ii, ii - 1); }
      else if (a === 'down-i') { tausch(b.items, ii, ii + 1); }
      else if (a === 'del-i') {
        if (!confirm('Frage ' + b.items[ii].code + ' löschen?')) { return; }
        b.items.splice(ii, 1);
      } else if (a === 'add-i') {
        var vorige = b.items[b.items.length - 1], vs = vorige && !SE.istRaster(vorige) && skala(vorige.skala);
        b.items.push({ code: freierCode(b.key), text: '', skala: vs && !vs.nurLeitfrage ? vs.id : normaleSkala() });
      } else if (a === 'add-skala') {
        var v = SKALEN_VORLAGEN[Number($('#ed-skalenvorlage', form).value)], id = v.id, n = 2;
        while (skala(id)) { id = v.id + '-' + n++; }
        var lang = v.stufen.some(function (s) { return s.length > 18; }) || v.stufen.length > 5;
        P.skalen.push({ id: id, name: v.name, stufen: v.stufen.slice(), anzeige: 'aufsteigend',
          darstellung: lang ? 'untereinander' : 'nebeneinander', niedrig: Math.floor((v.stufen.length - 1) / 3) });
        offen.skalen = true;
      } else if (a === 'del-skala') {
        var s = P.skalen[Number(t.dataset.s)];
        if (alleCodes().length && P.bereiche.some(function (bb) { return bb.items.some(function (x) { return x.skala === s.id; }); })) {
          status('Die Skala „' + s.name + '“ wird noch von Fragen genutzt. Stelle diese Fragen zuerst auf eine andere Skala um.', true);
          return;
        }
        if (P.skalen.length < 2) { status('Mindestens eine Skala muss bleiben.', true); return; }
        P.skalen.splice(Number(t.dataset.s), 1);
      } else { return; }
      angleichen();
      render();
    });


    return {
      laden: function (p) { P = normalisieren(clone(p), opt.basis || p); render(); return P; },
      projekt: function () { return P; },
      pruefen: pruefAnzeige
    };
  }

  return { erstellen: erstellen, normalisieren: normalisieren, SKALEN_VORLAGEN: SKALEN_VORLAGEN, TEXTE: TEXTE };
})();
if (typeof module !== 'undefined') { module.exports = SEFormular; }

function sbKern(SB_CFG) {
(function () {
  'use strict';

  var CFG = SB_CFG;

  var T = CFG.texte;
  var MODUS = CFG.modus; // 'punkte' (0–15), 'tendenz' (1, 1−, 2+ … 6) oder 'ganz' (1–6)
  var EPS = 1e-6;
  // Maßstab: Exponent für Skalenantworten (1 = geradlinig, größer = strenger). Rasterzeilen bleiben unverändert.
  var K = CFG.massstab || 1;
  // Freiwillige Textfelder, die im Bogen vorkommen 
  var REFL = CFG.reflexion || [{ code: 'Beispiel', kurz: 'Typischer Beitrag' }, { code: 'Vorsatz', kurz: 'Vorsatz' }];

  function norm(s) {
    return String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined && text !== null) { e.textContent = text; }
    return e;
  }
  // Platzhalter wie {n} in einem Text aus der Konfiguration ersetzen
  function fill(s, map) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return map[k] !== undefined ? map[k] : m; });
  }

  // Antwortskalen: Text der Stufe -> Position (0 = niedrigste Stufe)
  var SKALA = {};
  Object.keys(CFG.skalen).forEach(function (id) {
    var s = CFG.skalen[id], map = {};
    s.stufen.forEach(function (label, i) { map[norm(label)] = i; });
    SKALA[id] = { stufen: s.stufen, niedrig: s.niedrig, werte: s.werte, map: map };
  });

  function readItem(box, code) {
    var n = box.querySelector('[data-sb-item="' + code + '"]');
    return n ? norm(n.textContent) : '';
  }

  /* ---------- Noten und Punkte ----------
   * Gerechnet wird immer in Punkten 0–15. Für die Anzeige wird daraus eine Stufe:
   *   punkte:  Stufe = Punkte (0–15)
   *   tendenz: Stufe 0–14 (14 = 1, 13 = 1−, 12 = 2+ … 1 = 5−, 0 = 6). Eine 1+ gibt es nicht.
   *   ganz:    Stufe 0–5 (5 = Note 1 … 0 = Note 6)
   * Abweichungen werden in Stufen gezählt. */
  function grade(points) {
    if (points >= 13) { return 1; }
    if (points >= 10) { return 2; }
    if (points >= 7) { return 3; }
    if (points >= 4) { return 4; }
    if (points >= 1) { return 5; }
    return 6;
  }
  function noteLabel(points) {
    var g = grade(points);
    if (g === 6) { return '6'; }
    var pos = (points - 1) % 3; // 2 = oberes Drittel, 1 = Mitte, 0 = unteres Drittel
    return String(g) + (pos === 2 ? '+' : pos === 0 ? '−' : '');
  }
  function toStep(points) {
    if (MODUS === 'tendenz') { return Math.min(points, 14); }
    if (MODUS === 'ganz') { return 6 - grade(points); }
    return points;
  }
  function stepGrade(step) { return MODUS === 'ganz' ? 6 - step : grade(step); }
  // „11“, „2+“ bzw. „2“: kurze Form für Tabellen
  function short(step) {
    if (MODUS === 'tendenz') { return noteLabel(step); }
    if (MODUS === 'ganz') { return String(6 - step); }
    return String(step);
  }
  // „11 Punkte“ bzw. „die Note 2“: im Satz
  function amount(step) {
    return MODUS === 'punkte' ? step + (step === 1 ? ' Punkt' : ' Punkte') : 'die Note ' + short(step);
  }
  // Abstand: „3 Punkte“, „3 Teilnotenstufen“ bzw. „2 Noten“
  function unit(n) {
    if (MODUS === 'punkte') { return n + (n === 1 ? ' Punkt' : ' Punkte'); }
    if (MODUS === 'tendenz') { return n === 1 ? 'eine Teilnotenstufe' : n + ' Teilnotenstufen'; }
    return n === 1 ? 'eine Note' : n + ' Noten';
  }
  // Ergebnis in der Liste: „11 P. · 2“, „2+“ bzw. „2“
  function pill(step) { return MODUS === 'punkte' ? step + ' P. · ' + noteLabel(step) : short(step); }
  function heroNote(step) { return MODUS === 'ganz' ? short(step) : noteLabel(step); }
  // Note als Text („2+“, „3“, „4−“ oder „4-“) in eine Stufe umrechnen. „1+“ zählt als 1.
  function parseNote(s) {
    var m = /^([1-6])\s*([+\-−–]?)$/.exec(String(s || '').trim());
    if (!m) { return null; }
    var g = parseInt(m[1], 10);
    if (MODUS === 'ganz') { return 6 - g; }
    if (g === 6) { return 0; }
    var v = 17 - 3 * g;
    if (m[2] === '+') { v += 1; } else if (m[2]) { v -= 1; }
    return Math.min(v, 14);
  }
  function parseExpectation(s) {
    if (MODUS !== 'punkte') { return parseNote(s); }
    var v = parseInt(s, 10);
    return isNaN(v) ? null : Math.max(0, Math.min(v, 15));
  }
  // Spontane Erwartung „passt“ zum Ergebnis: höchstens 1 Punkt bzw. 1 Teilnotenstufe Abstand, bei ganzen Noten genau.
  function passt(d) { return Math.abs(d) <= (MODUS === 'ganz' ? 0 : 1); }
  function fmtDiff(d) {
    if (d === null) { return ''; }
    return (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d);
  }

  /* ---------- Berechnung ---------- */
  function evaluate(box) {
    var sums = {}, counts = {}, mins = {}, missing = [], low = [], plain = [];
    var cap = 15, capItem = null, capAnswer = null;
    CFG.dims.forEach(function (d) { sums[d.key] = 0; counts[d.key] = 0; mins[d.key] = Infinity; });
    CFG.items.forEach(function (it) {
      var sk = SKALA[it.skala], raw = readItem(box, it.code);
      var idx = Object.prototype.hasOwnProperty.call(sk.map, raw) ? sk.map[raw] : null;
      if (idx === null) { missing.push(it.code); return; }
      // Alle Skalen werden auf 0–4 umgerechnet, egal wie viele Stufen sie haben.
      // Rasterzeilen bringen eigene Werte mit (Mitte des Notenbereichs).
      var v = sk.werte ? sk.werte[idx] : Math.pow(idx / (sk.stufen.length - 1), K) * 4;
      if (it.grenzen) {
        // Leitfrage mit Obergrenze: steht bei niedriger Antwort vorne, mit der Angabe
        if (it.grenzen[idx] < cap) { cap = it.grenzen[idx]; capItem = it; capAnswer = sk.stufen[idx]; }
        if (idx <= sk.niedrig) { low.unshift({ item: it, answer: sk.stufen[idx] }); }
      } else {
        if (idx <= sk.niedrig) { low.push({ item: it }); }
        plain.push({ v: v, label: sk.stufen[idx], skala: it.skala });
      }
      sums[it.dim] += v; counts[it.dim] += 1;
      if (v < mins[it.dim]) { mins[it.dim] = v; }
    });
    var dims = [], total = 0, wsum = 0;
    CFG.dims.forEach(function (d) {
      if (!counts[d.key]) { return; }
      var mean = sums[d.key] / counts[d.key];
      dims.push({ key: d.key, name: d.name, tips: d.tips, weight: d.weight, mean: mean, min: mins[d.key], pct: Math.round(mean / 4 * 100) });
      total += mean * d.weight; wsum += d.weight;
    });
    if (!wsum) { return null; }
    var rawPts = Math.round(total / wsum / 4 * 15);
    var step = toStep(Math.min(rawPts, cap)), rawStep = toStep(rawPts);
    // Überall dieselbe Antwort (ohne Leitfragen): Dann sagt die Auswertung wenig aus.
    var uniform = null;
    if (!missing.length && plain.length > 1 && plain.every(function (p) { return Math.abs(p.v - plain[0].v) < EPS; })) {
      var oneScale = plain.every(function (p) { return p.skala === plain[0].skala; });
      uniform = oneScale ? '„' + plain[0].label + '“' : 'jeweils dieselbe Stufe';
    }
    return {
      points: step, raw: rawStep, cap: toStep(cap), capped: rawStep > step, capItem: capItem, capAnswer: capAnswer,
      dims: dims, missing: missing, low: low, uniform: uniform,
      expectation: parseExpectation(readItem(box, 'Erwartung'))
    };
  }

  /* ---------- Stärke und Entwicklungsfeld ---------- */
  // Bereiche mit dem höchsten (dir = 1) bzw. niedrigsten (dir = -1) Mittelwert.
  // Bei Gleichstand entscheidet die stärkste bzw. schwächste Einzelangabe im Bereich.
  // Bleibt es danach gleich, werden alle gleichauf liegenden Bereiche zurückgegeben.
  function extremes(dims, dir) {
    function pick(list, prop) {
      var m = list.reduce(function (acc, d) {
        return dir > 0 ? Math.max(acc, d[prop]) : Math.min(acc, d[prop]);
      }, dir > 0 ? -Infinity : Infinity);
      return list.filter(function (d) { return Math.abs(d[prop] - m) < EPS; });
    }
    return pick(pick(dims, 'mean'), 'min');
  }
  function joinNames(list) {
    // Mehrere Namen in Anführungszeichen, weil sie selbst „und“ enthalten.
    var n = list.map(function (d) { return list.length < 2 ? d.name : '„' + d.name + '“'; });
    return n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' und ' + n[n.length - 1];
  }

  /* ---------- Einzelansicht ---------- */
  function renderSingle(box) {
    var target = box.querySelector('.sb-result');
    if (!target) { return; }
    var r = evaluate(box);
    target.innerHTML = '';
    if (!r || r.missing.length) {
      target.appendChild(el('p', 'sb-alert', 'Nicht alle Fragen sind beantwortet' +
        (r && r.missing.length ? ' (' + r.missing.join(', ') + ')' : '') +
        '. Bearbeite deinen Eintrag, dann erscheint hier deine Rückmeldung.'));
      return;
    }
    var g = stepGrade(r.points), note = CFG.notes[String(g)];

    // Ergebnis-Kopf
    var hero = el('div', 'sb-hero sb-g' + g);
    var badge = el('div', 'sb-badge');
    badge.appendChild(el('span', 'sb-pts', short(r.points)));
    badge.appendChild(el('span', 'sb-ptslbl', MODUS === 'punkte' ? (r.points === 1 ? 'Punkt' : 'Punkte') : 'Note'));
    hero.appendChild(badge);
    var ht = el('div', 'sb-herotext');
    ht.appendChild(el('div', 'sb-kicker', 'Deine Angaben entsprechen ungefähr'));
    ht.appendChild(el('div', 'sb-note', 'Note ' + heroNote(r.points) + ' (' + note.word + ')'));
    ht.appendChild(el('div', 'sb-nvo', note.nvo));
    hero.appendChild(ht);
    target.appendChild(hero);

    if (r.uniform) {
      target.appendChild(el('p', 'sb-alert sb-uniform', fill(T.gleicheAntwort, { antwort: r.uniform })));
    }

    var card = el('div', 'sb-card');
    card.appendChild(el('h3', null, T.bogenTitel));
    card.appendChild(el('p', null, note.bogen));

    if (r.capped) {
      var cap = el('div', 'sb-capnote');
      cap.appendChild(el('strong', null, 'Warum nicht mehr? '));
      cap.appendChild(document.createTextNode(fill(T.kappung, {
        raw: amount(r.raw), rawKurz: short(r.raw), freq: r.capAnswer, cap: amount(r.cap), capKurz: short(r.cap)
      })));
      card.appendChild(cap);
    }

    if (r.expectation !== null) {
      var diff = r.expectation - r.points, cmp = el('div', 'sb-compare');
      var map = { exp: amount(r.expectation), res: short(r.points), n: unit(Math.abs(diff)) };
      var txt = fill(T.vergleich, map) + ' ';
      if (passt(diff)) {
        txt += fill(T.vergleichPasst, map);
      } else {
        txt += fill(diff > 0 ? T.vergleichHoeher : T.vergleichNiedriger, map);
        cmp.className += ' sb-off';
      }
      cmp.textContent = txt;
      card.appendChild(cmp);
    }
    target.appendChild(card);

    // Bereiche
    var dc = el('div', 'sb-card');
    dc.appendChild(el('h3', null, 'Deine Bereiche im Überblick'));
    r.dims.forEach(function (d) {
      var rowEl = el('div', 'sb-bar');
      rowEl.appendChild(el('span', 'sb-barlbl', d.name));
      var track = el('span', 'sb-track'), bar = el('span', 'sb-fill');
      bar.style.width = d.pct + '%';
      bar.className += d.pct >= 75 ? ' sb-hi' : d.pct >= 50 ? ' sb-mid' : ' sb-lo';
      track.appendChild(bar);
      rowEl.appendChild(track);
      rowEl.appendChild(el('span', 'sb-barpct', d.pct + ' %'));
      dc.appendChild(rowEl);
    });
    target.appendChild(dc);

    // Stärke und Entwicklungsfeld
    // Bei Gleichstand wird kein Bereich willkürlich gewählt.
    var bestSet = extremes(r.dims, 1), worstSet = extremes(r.dims, -1);
    var best = bestSet[0], worst = worstSet[0];
    var spread = best.mean - worst.mean, allEqual = spread < EPS;
    var lowMeans = r.dims.filter(function (d) { return Math.abs(d.mean - worst.mean) < EPS; });
    var sw = el('div', 'sb-grid2');
    var s1 = el('div', 'sb-card sb-strength');
    s1.appendChild(el('h3', null, 'Deine Stärke'));
    if (allEqual) {
      s1.appendChild(el('p', null, 'Alle Bereiche schätzt du im Durchschnitt gleich ein. Kein Bereich sticht heraus.'));
    } else {
      s1.appendChild(el('p', null, joinNames(bestSet) + ': Hier schätzt du dich am besten ein. Baue darauf auf.'));
    }
    sw.appendChild(s1);
    var s2 = el('div', 'sb-card sb-develop'), tips = null;
    s2.appendChild(el('h3', null, 'Dein Entwicklungsfeld'));
    if (r.capped) {
      worst = r.dims.filter(function (d) { return d.key === r.capItem.dim; })[0] || worst;
      s2.appendChild(el('p', null, fill(T.kappungEntwicklung, { bereich: worst.name })));
      tips = worst.tips;
    } else if (allEqual && worst.mean >= 4 - EPS) {
      s2.appendChild(el('p', null, 'Du gibst dir in allen Bereichen die Höchstwertung. ' +
        'Prüfe im Gespräch mit deinem Fachlehrer, ob er das genauso sieht.'));
    } else if (worstSet.length > 1) {
      s2.appendChild(el('p', null, (allEqual ? 'Deine Bereiche liegen gleichauf.' :
        joinNames(worstSet) + ' liegen bei dir gleichauf am niedrigsten.') +
        ' Wähle einen davon aus, den du gezielt stärken willst' + (worstSet.some(function (d) { return d.tips.length; }) ? ':' : '.')));
      var ulc = el('ul', 'sb-tips');
      worstSet.forEach(function (d) {
        if (!d.tips.length) { return; }
        var li = el('li');
        li.appendChild(el('strong', null, d.name + ': '));
        li.appendChild(document.createTextNode(d.tips[0]));
        ulc.appendChild(li);
      });
      s2.appendChild(ulc);
    } else if (lowMeans.length > 1) {
      // Gleicher Mittelwert, entschieden durch die schwächste Einzelangabe.
      s2.appendChild(el('p', null, (allEqual ? 'Deine Bereiche liegen im Durchschnitt gleichauf.' :
        'Am niedrigsten liegen ' + joinNames(lowMeans) + '.') + ' Im Bereich „' + worst.name +
        '“ steht deine schwächste Einzelangabe. Dort kannst du gezielt ansetzen.'));
      tips = worst.tips;
    } else if (spread < 0.25) {
      s2.appendChild(el('p', null, 'Deine Bereiche liegen nah beieinander. Am niedrigsten liegt ' + worst.name +
        '. Dort kannst du gezielt ansetzen.'));
      tips = worst.tips;
    } else {
      s2.appendChild(el('p', null, worst.name + ': Hier liegt dein größtes Potenzial.'));
      tips = worst.tips;
    }
    if (tips && tips.length) {
      var ul = el('ul', 'sb-tips');
      tips.forEach(function (t) { ul.appendChild(el('li', null, t)); });
      s2.appendChild(ul);
    }
    sw.appendChild(s2);
    target.appendChild(sw);

    if (r.low.length) {
      var lc = el('div', 'sb-card');
      lc.appendChild(el('h3', null, 'Konkrete Ansatzpunkte'));
      lc.appendChild(el('p', 'sb-sub', T.ansatzpunkte));
      var l = el('ul', 'sb-lowlist');
      r.low.forEach(function (x) {
        var li = el('li');
        li.appendChild(el('span', 'sb-code', x.item.code));
        li.appendChild(document.createTextNode(' ' + x.item.text));
        if (x.answer) { li.appendChild(document.createTextNode(' Deine Angabe: „' + x.answer + '“')); }
        l.appendChild(li);
      });
      lc.appendChild(l);
      target.appendChild(lc);
    }

    target.appendChild(el('p', 'sb-disclaimer',
      'Diese Rückmeldung ist eine Orientierung auf Grundlage deiner eigenen Angaben, keine Note. ' +
      'Deine mündliche Note legt dein Fachlehrer fest. Nutze das Ergebnis für ein Gespräch mit ihm' +
      (REFL.some(function (f) { return f.code === 'Vorsatz'; }) ? ' und für deinen Vorsatz unten.' : '.')));
  }

  /* ---------- Listenansicht ---------- */
  function renderRow(row) {
    var r = evaluate(row), res = row.querySelector('.sb-res'), dif = row.querySelector('.sb-diff');
    if (!res) { return; }
    if (!r || r.missing.length) { res.textContent = 'unvollständig'; return; }
    res.innerHTML = '';
    var b = el('span', 'sb-pill sb-g' + stepGrade(r.points), pill(r.points));
    var hints = [];
    if (r.capped) { hints.push(T.kappungKurz + ' (rechnerisch ' + amount(r.raw) + ')'); b.textContent += ' ▾'; }
    if (r.uniform) { hints.push('Bei allen Aussagen dieselbe Antwort: ' + r.uniform); b.textContent += ' ≡'; }
    if (hints.length) { b.title = hints.join(' · '); }
    res.appendChild(b);
    if (dif && r.expectation !== null) {
      var d = r.expectation - r.points;
      dif.textContent = fmtDiff(d);
      dif.title = d > 0 ? 'spontan um ' + unit(d) + ' besser eingeschätzt' : d < 0 ? 'spontan um ' + unit(-d) + ' strenger eingeschätzt' : 'spontane Einschätzung stimmt überein';
      if (!passt(d)) { dif.className += ' sb-off'; }
    }
  }

  /* ---------- Sichtbarkeit und Navigation ---------- */
  function checkVisibility() {
    var nodes = document.querySelectorAll('[data-sb-status]'), approvalOff = false;
    nodes.forEach(function (n) {
      var st = n.getAttribute('data-sb-status');
      if (st === '') { approvalOff = true; return; }
      if (st !== 'approved') { return; }
      var msg = 'Achtung: Dieser Eintrag ist freigegeben und damit für alle Kursteilnehmer sichtbar. ' +
        'Bitte die Freigabe mit dem Symbol beim Eintrag zurücknehmen.';
      var w = n.querySelector('.sb-warn');
      if (w) { w.textContent = msg; w.hidden = false; }
      else if (n.classList.contains('sb-row')) { n.classList.add('sb-public'); n.title = msg; }
    });
    if (approvalOff) {
      var txt = 'Achtung: In den Einstellungen dieser Datenbank ist „Freigabe erforderlich“ nicht aktiviert. ' +
        'Damit sehen alle Kursteilnehmer alle Einträge. Bitte unter Einstellungen › Einträge › „Freigabe erforderlich“ auf „Ja“ stellen.';
      document.querySelectorAll('.sb-setupwarn, .sb-entry .sb-warn').forEach(function (w) {
        w.textContent = txt; w.hidden = false;
      });
    }
  }

  /* ---------- Lehreransicht: Druck und Export ---------- */
  function isTeacher() {
    // ##approve## und ##disapprove## erzeugt Moodle nur für Nutzer mit dem Recht mod/data:approve.
    return !!document.querySelector('.sb-row .sb-tmark a, .sb-row .disapprove a');
  }
  function txt(node) {
    return node ? String(node.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : '';
  }
  function cell(row, sel) { return txt(row.querySelector(sel)); }

  var MONTHS = {
    januar: 1, jänner: 1, january: 1, februar: 2, february: 2, märz: 3, march: 3, april: 4, mai: 5, may: 5,
    juni: 6, june: 6, juli: 7, july: 7, august: 8, september: 9, oktober: 10, october: 10,
    november: 11, dezember: 12, december: 12
  };
  function shortDate(s) {
    var m = /(\d{1,2})\.?\s+([A-Za-zÄÖÜäöü]+)\s+(\d{4})/.exec(s);
    if (!m || !MONTHS[m[2].toLowerCase()]) { return s; }
    var mo = MONTHS[m[2].toLowerCase()];
    return (m[1].length < 2 ? '0' : '') + m[1] + '.' + (mo < 10 ? '0' : '') + mo + '.' + m[3];
  }
  function today() {
    var d = new Date();
    return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear();
  }

  function collect() {
    var list = [];
    document.querySelectorAll('.sb-row').forEach(function (row) {
      var r = evaluate(row), ok = !!(r && !r.missing.length), dims = {};
      if (r) { r.dims.forEach(function (d) { dims[d.key] = d.pct; }); }
      list.push({
        user: cell(row, '[data-sb-col="user"]'),
        fach: cell(row, '[data-sb-col="fach"]'),
        halbjahr: cell(row, '[data-sb-col="halbjahr"]'),
        datum: shortDate(cell(row, '[data-sb-col="datum"]')),
        erwartung: r && r.expectation !== null ? r.expectation : null,
        ok: ok,
        points: ok ? r.points : null,
        raw: ok ? r.raw : null,
        capped: ok && r.capped,
        uniform: ok && !!r.uniform,
        diff: ok && r.expectation !== null ? r.expectation - r.points : null,
        dims: dims,
        answers: CFG.items.map(function (it) { return cell(row, '[data-sb-item="' + it.code + '"]'); }),
        texte: REFL.map(function (f) { return cell(row, '[data-sb-item="' + f.code + '"]'); })
      });
    });
    return list;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function printList(bar) {
    var rows = collect();
    var withText = REFL.length > 0 && !!(bar.querySelector('.sb-withtext') || {}).checked;
    var ncols = 8 + CFG.dims.length;
    var head = '<tr><th>Nr.</th><th>Schüler</th><th>Fach</th><th>' + esc(T.spalteHalbjahr) + '</th><th>Datum</th>' +
      '<th class="c">Erwartung</th><th class="c">Ergebnis</th><th class="c">Abw.</th>' +
      CFG.dims.map(function (d) { return '<th class="c">' + esc(d.short || d.name) + '</th>'; }).join('') + '</tr>';
    var body = rows.map(function (e, i) {
      var res = e.ok ? esc(pill(e.points)) + (e.capped ? ' <span class="cap">(rechn. ' + esc(short(e.raw)) + ')</span>' : '') +
        (e.uniform ? ' <span class="cap">≡</span>' : '') : 'unvollständig';
      var tr = '<tr class="entry' + (withText ? ' has-txt' : '') + '"><td class="c">' + (i + 1) + '</td><td><b>' + esc(e.user) + '</b></td><td>' + esc(e.fach) +
        '</td><td>' + esc(e.halbjahr) + '</td><td>' + esc(e.datum) + '</td><td class="c">' +
        (e.erwartung === null ? '' : esc(short(e.erwartung))) + '</td><td class="c res">' + res + '</td><td class="c' +
        (e.diff !== null && !passt(e.diff) ? ' off' : '') + '">' + esc(fmtDiff(e.diff)) + '</td>' +
        CFG.dims.map(function (d) {
          return '<td class="c">' + (e.dims[d.key] === undefined ? '' : e.dims[d.key] + ' %') + '</td>';
        }).join('') + '</tr>';
      if (withText) {
        tr += '<tr class="txt"><td></td><td colspan="' + (ncols - 1) + '">' + REFL.map(function (f, k) {
          return '<b>' + esc(f.kurz) + ':</b> ' + (esc(e.texte[k]) || '–');
        }).join('<br>') + '</td></tr>';
      }
      return tr;
    }).join('');
    var anyCap = rows.some(function (e) { return e.capped; });
    var anyUniform = rows.some(function (e) { return e.uniform; });
    var html = '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">' +
      '<title>' + esc(T.titel) + ' – Übersicht</title><style>' +
      '@page{size:A4 landscape;margin:12mm}' +
      'body{font-family:"Segoe UI",Arial,sans-serif;font-size:10pt;color:#10333a;margin:16px}' +
      'h1{font-size:15pt;margin:0 0 2px;color:#0b4f61}.meta{margin:0 0 10px;color:#4b6b72}' +
      'table{width:100%;border-collapse:collapse}th,td{border:1px solid #9cc7d1;padding:4px 6px;text-align:left;vertical-align:top}' +
      'th{background:#e6f6f9;-webkit-print-color-adjust:exact;print-color-adjust:exact}thead{display:table-header-group}' +
      'tr{page-break-inside:avoid;break-inside:avoid}.c{text-align:center}.res{white-space:nowrap;font-weight:700}' +
      '.cap{font-weight:400;color:#b45309}.off{color:#b45309;font-weight:700}' +
      'tr.txt td{font-size:9pt;background:#f7fbfc;border-top:0}tr.entry.has-txt td{border-bottom:0}' +
      '.note{margin-top:8px;font-size:8.5pt;color:#4b6b72}.bar{margin-bottom:12px}' +
      '.bar button{font:inherit;padding:6px 14px;border-radius:999px;border:0;background:#0e7490;color:#fff;cursor:pointer}' +
      '@media print{.bar{display:none}body{margin:0}}' +
      '</style></head><body>' +
      '<div class="bar"><button type="button" onclick="window.print()">Drucken / als PDF speichern</button></div>' +
      '<h1>' + esc(T.titel) + '</h1>' +
      '<p class="meta">Übersicht · Stand: ' + today() + ' · ' + rows.length + (rows.length === 1 ? ' Eintrag' : ' Einträge') + '</p>' +
      '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      '<p class="note">Ergebnis und Bereichswerte sind aus den Selbstangaben der Schüler berechnet und dienen als Orientierung, nicht als Note. ' +
      esc(T.druckAbweichung) + (anyCap ? ' ' + esc(T.druckRechnerisch) : '') +
      (anyUniform ? ' ≡ = bei allen Aussagen dieselbe Antwort.' : '') + '</p>' +
      '</body></html>';
    if (typeof CFG.faerben === 'function') { html = CFG.faerben(html); }
    var w = window.open('', '_blank');
    if (!w) {
      showMsg(bar, 'Das Druckfenster wurde vom Browser blockiert. Bitte Pop-ups für diese Seite erlauben und erneut klicken.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(function () { w.print(); }, 400);
  }

  function csvCell(v) {
    v = v === null || v === undefined ? '' : String(v);
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function exportCsv(bar) {
    var rows = collect();
    var P = MODUS === 'punkte';
    var head = ['Schüler', 'Fach', T.spalteHalbjahr, 'Datum']
      .concat(P ? ['Erwartung', 'Punkte', 'Punkte rechnerisch', 'Note', 'Abweichung'] :
        ['Erwartung (Note)', 'Note', 'Note rechnerisch', MODUS === 'tendenz' ? 'Abweichung (Teilnotenstufen)' : 'Abweichung (Noten)'])
      .concat(['Begrenzt durch Beteiligung', 'Überall gleiche Antwort'])
      .concat(CFG.dims.map(function (d) { return d.name + ' (%)'; }))
      .concat(CFG.items.map(function (it) { return it.code; }))
      .concat(REFL.map(function (f) { return f.kurz; }));
    var lines = [head.map(csvCell).join(';')];
    rows.forEach(function (e) {
      var exp = e.erwartung === null ? '' : P ? e.erwartung : short(e.erwartung);
      var res = P ? [exp, e.points, e.raw, e.ok ? noteLabel(e.points) : 'unvollständig', e.diff] :
        [exp, e.ok ? short(e.points) : 'unvollständig', e.ok ? short(e.raw) : '', e.diff];
      lines.push([e.user, e.fach, e.halbjahr, e.datum].concat(res)
        .concat([e.ok ? (e.capped ? 'ja' : 'nein') : '', e.ok ? (e.uniform ? 'ja' : 'nein') : ''])
        .concat(CFG.dims.map(function (d) { return e.dims[d.key] === undefined ? '' : e.dims[d.key]; }))
        .concat(e.answers)
        .concat(e.texte)
        .map(csvCell).join(';'));
    });
    var d = new Date();
    var name = T.dateiname + '-' + d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2) + '.csv';
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    if (window.navigator && window.navigator.msSaveOrOpenBlob) { window.navigator.msSaveOrOpenBlob(blob, name); return; }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function showMsg(bar, text) {
    var m = bar.querySelector('.sb-tmsg');
    if (m) { m.textContent = text; m.hidden = false; }
  }

  function initTeacher() {
    var bar = document.querySelector('.sb-teacherbar');
    if (!bar || !isTeacher()) { return; }
    bar.hidden = false;
    var mit = bar.querySelector('.sb-withtext');
    if (mit && !REFL.length) { mit.closest('label').hidden = true; }
    document.querySelectorAll('.sb-studentinfo').forEach(function (n) { n.hidden = true; });
    if (document.querySelector('#region-main .pagination, [role="main"] .pagination')) {
      var h = bar.querySelector('.sb-pagehint');
      if (h) { h.hidden = false; }
    }
    bar.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-sb-action]');
      if (!b) { return; }
      if (b.getAttribute('data-sb-action') === 'print') { printList(bar); }
      if (b.getAttribute('data-sb-action') === 'csv') { exportCsv(bar); }
    });
  }

  function fixBackLinks() {
    var link = CFG.kursLink;
    if (!link || link.indexOf('LINK-ZUM-KURS') !== -1) {
      var a = document.querySelector('a[href*="/course/view.php?id="]');
      link = a ? a.href : null;
    }
    document.querySelectorAll('.sb-back').forEach(function (b) {
      if (link) { b.href = link; } else { b.addEventListener('click', function (e) { e.preventDefault(); history.back(); }); }
    });
  }

  function init() {
    fixBackLinks();
    document.querySelectorAll('.sb-entry').forEach(renderSingle);
    document.querySelectorAll('.sb-row').forEach(renderRow);
    checkVisibility();
    initTeacher();
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
}

/*  Einstellungen in Moodle: Den Bogen stellt die Lehrkraft direkt in der Datenbank ein.
 *
 * Speicher ist die Datenbank selbst:
 *  - Ein Eintrag mit Typ „Einstellung“ enthält den ganzen Bogen (als JSON), kodiert im Feld „Einstellung“.
 *    Ihn legt die Lehrkraft an. Einträge von Lehrkräften gibt Moodle sofort frei, deshalb lesen ihn auch die Schüler.
 *  - Jede Selbsteinschätzung ist ein Eintrag mit Typ „Einschaetzung“. Die Antworten stehen kodiert im Feld „Antworten“.
 *    Diese Einträge bleiben unfreigegeben und sind damit nur für den Schüler und die Lehrkraft sichtbar.
 * Gelesen wird über die Listenansicht, geschrieben über das normale Eingabeformular (edit.php). Moodle prüft alle Rechte.
 *
 * Gebraucht werden SE (generator.js), SEFormular (formular.js) und sbKern (kern.js als Funktion).
 */
(function () {
  'use strict';

  var VORLAGEN = [{"id":"einstellbar/oberstufe","name":"Oberstufe (Punkte 0–15)","projekt":{"format":"selbsteinschaetzung-editor","version":1,"name":"Oberstufe (Punkte 0–15)","modus":"punkte","kursLink":"LINK-ZUM-KURS","beschreibung":"<p>Mit diesem Bogen schätzt du deine mündliche Leistung selbst ein. Deinen Eintrag sehen nur du und deine Lehrkraft. Der Bogen dient nur zu deiner Selbsteinschätzung und hat keinen Einfluss auf etwaige Noten.</p>","kommentare":false,"felder":{"Fach":{"label":"Fach","beschreibung":"Fach","optionen":["Gemeinschaftskunde","Wirtschaft"]},"Halbjahr":{"label":"Halbjahr","beschreibung":"Kurshalbjahr","optionen":["J1 / 1. Halbjahr","J1 / 2. Halbjahr","J2 / 1. Halbjahr","J2 / 2. Halbjahr"]},"Erwartung":{"label":"Bevor du startest: Wie viele Punkte würdest du dir spontan für deine mündliche Leistung geben?","beschreibung":"Spontane Einschätzung in Punkten vor dem Ausfüllen","hinweis":"Nach dem Ausfüllen vergleichst du diese Zahl mit dem Ergebnis."},"Beispiel":{"label":"Beschreibe einen Beitrag aus den letzten Wochen, der für deine mündliche Leistung typisch ist.","beschreibung":"Ein Beitrag aus den letzten Wochen, der für meine mündliche Leistung typisch ist","kurz":"Typischer Beitrag"},"Vorsatz":{"label":"Was nimmst du dir für die nächsten Wochen konkret vor?","beschreibung":"Was ich mir für die nächsten Wochen konkret vornehme","kurz":"Vorsatz für die nächsten Wochen"}},"skalen":[{"id":"haeufigkeit","name":"Meldehäufigkeit (A1)","stufen":["nie, auch nach Aufforderung kaum","selten, meist erst nach Aufforderung","gelegentlich","in den meisten Stunden","in fast jeder Stunde","in fast jeder Stunde mehrfach"],"anzeige":"absteigend","darstellung":"untereinander","niedrig":1,"nurLeitfrage":true},{"id":"haeufigkeit5","name":"Häufigkeit (5 Stufen)","stufen":["nie","selten","manchmal","oft","fast immer"],"anzeige":"aufsteigend","darstellung":"nebeneinander","niedrig":1,"nurLeitfrage":false},{"id":"koennen4","name":"Können (4 Stufen)","stufen":["kann ich noch nicht","kann ich teilweise","kann ich meistens","kann ich sicher"],"anzeige":"aufsteigend","darstellung":"nebeneinander","niedrig":1,"nurLeitfrage":false},{"id":"zustimmung","name":"Zustimmung (5 Stufen)","stufen":["trifft nicht zu","trifft selten zu","trifft teilweise zu","trifft überwiegend zu","trifft voll zu"],"anzeige":"aufsteigend","darstellung":"nebeneinander","niedrig":1,"nurLeitfrage":false}],"bereiche":[{"key":"A","name":"Beteiligung","short":"Beteiligung","weight":25,"frage":"Wie regelmäßig und von dir aus bringst du dich ein?","tips":["Nimm dir für jede Stunde mindestens einen festen Beitrag vor, zum Beispiel beim Stundeneinstieg oder in der Sicherungsphase.","Melde dich auch mit Teilantworten oder Rückfragen. Eine präzise Frage ist ebenfalls ein Beitrag.","Wiederhole vor der Stunde kurz die letzte Stunde, damit du gleich zu Beginn einsteigen kannst."],"items":[{"code":"A1","text":"Wie oft beteilige ich mich freiwillig am Unterrichtsgespräch?","hinweis":"Denke an die letzten Wochen, nicht an einzelne Stunden.","skala":"haeufigkeit","grenzen":[2,5,8,11,13,15]},{"code":"A2","text":"Ich melde mich von mir aus, ohne aufgerufen zu werden, auch bei schwierigen Fragen.","skala":"haeufigkeit5"},{"code":"A3","text":"Meine Beteiligung ist über die Stunde und das Halbjahr hinweg gleichmäßig, nicht nur bei Themen, die mich besonders interessieren.","skala":"zustimmung"}]},{"key":"B","name":"Fachwissen und Fachsprache","short":"Fachwissen","weight":20,"frage":"Wie sicher ist dein Wissen und wie gut nutzt du Fachbegriffe?","tips":["Lege dir ein Glossar mit den Fachbegriffen der aktuellen Einheit an und verwende die Begriffe bewusst in deinen Beiträgen.","Verfolge regelmäßig Nachrichten und Wirtschaftsmeldungen und suche nach Bezügen zum Unterricht.","Frage dich bei neuen Inhalten: Wo ist uns das in früheren Themen schon begegnet?"],"items":[{"code":"B1","text":"Ich kann Inhalte und Zusammenhänge der letzten Stunden sachlich richtig wiedergeben.","hinweis":"zum Beispiel beim Stundeneinstieg oder bei Wiederholungen","skala":"koennen4"},{"code":"B2","text":"Ich verwende Fachbegriffe von mir aus und korrekt.","hinweis":"zum Beispiel Gewaltenteilung, Legitimation, Opportunitätskosten, Marktversagen","skala":"haeufigkeit5"},{"code":"B3","text":"Ich kann neue Inhalte mit früheren Themen der Unterrichtseinheit oder des Kurses verknüpfen.","skala":"koennen4"},{"code":"B4","text":"Mein Wissen reicht über den Unterrichtsstoff hinaus, weil ich aktuelle politische und wirtschaftliche Entwicklungen verfolge.","skala":"zustimmung"}]},{"key":"C","name":"Analyse und Gedankenführung","short":"Analyse","weight":20,"frage":"Erkennst du Probleme und ordnest du sie in Zusammenhänge ein?","tips":["Achte auf den Operator einer Frage und baue deine Antwort danach auf.","Kläre bei jedem Sachverhalt: Welche Akteure gibt es, welche Interessen verfolgen sie, welche Ursachen und Folgen sind erkennbar?","Werte Materialien schrittweise aus: Thema, Kernaussage, Einordnung, kritische Prüfung."],"items":[{"code":"C1","text":"Ich kann das Kernproblem einer Frage oder Unterrichtsphase erkennen und Wesentliches von Unwesentlichem unterscheiden.","skala":"koennen4"},{"code":"C2","text":"Ich kann Sachverhalte in größere Zusammenhänge einordnen.","hinweis":"Akteure, Interessen, Ursachen und Folgen","skala":"koennen4"},{"code":"C3","text":"Ich beachte die Operatoren einer Frage und antworte entsprechend.","hinweis":"zum Beispiel nennen, erläutern, analysieren, beurteilen","skala":"haeufigkeit5"},{"code":"C4","text":"Ich kann Materialien sachgerecht auswerten.","hinweis":"Texte, Statistiken, Schaubilder, Karikaturen","skala":"koennen4"}]},{"key":"D","name":"Argumentation und Urteil","short":"Argumentation","weight":20,"frage":"Begründest du deine Positionen und urteilst du abgewogen?","tips":["Stütze jede Position mit mindestens einem Argument und einem Beleg oder Beispiel.","Knüpfe ausdrücklich an Beiträge von Mitschülern an: ergänzen, präzisieren oder begründet widersprechen.","Nenne die Kriterien, nach denen du urteilst, und wäge Gegenargumente ab, bevor du dich festlegst."],"items":[{"code":"D1","text":"Ich begründe meine Aussagen mit Argumenten und belege sie mit Beispielen, Daten oder Material.","skala":"haeufigkeit5"},{"code":"D2","text":"Ich beziehe mich auf Beiträge von Mitschülern: Ich greife sie auf, ergänze sie oder widerspreche begründet.","skala":"haeufigkeit5"},{"code":"D3","text":"Ich kann zu einem eigenen, abgewogenen Urteil kommen, Gegenpositionen berücksichtigen und meine Kriterien nennen.","hinweis":"zum Beispiel Effizienz, Legitimität, Gerechtigkeit, Nachhaltigkeit","skala":"koennen4"}]},{"key":"E","name":"Eigene Impulse und Interesse","short":"Impulse","weight":15,"frage":"Bringst du den Unterricht mit eigenen Ideen voran?","tips":["Bringe pro Woche eine eigene Frage oder ein aktuelles Beispiel in den Unterricht mit.","Bereite Hausaufgaben, Lektüre und Material so vor, dass du in der Stunde mitreden kannst.","Notiere während der Stunde offene Fragen und bringe sie ins Gespräch ein."],"items":[{"code":"E1","text":"Ich bringe eigene Fragen, Beispiele oder Ideen ein, die das Unterrichtsgespräch voranbringen.","skala":"haeufigkeit5"},{"code":"E2","text":"Ich bin gut vorbereitet (Hausaufgaben, Lektüre, Material), sodass ich mitreden kann.","skala":"haeufigkeit5"},{"code":"E3","text":"Ich zeige im Unterricht Interesse am Fach, etwa durch Nachfragen und aufmerksames Zuhören.","skala":"haeufigkeit5"}]}],"noten":{"1":{"word":"sehr gut","nvo":"Die Leistung entspricht den Anforderungen in besonderem Maße.","bogen":"Du beteiligst dich konstant überragend. Du erkennst Probleme, ordnest sie in den Gesamtzusammenhang ein, trägst eigenständig zu ihrer Lösung bei und urteilst sachgerecht und ausgewogen unter Verwendung von Fachbegriffen. Deine Impulse bringen den Unterricht voran, dein Wissen reicht über den behandelten Stoff hinaus, und du zeigst sehr großes Interesse am Fach."},"2":{"word":"gut","nvo":"Die Leistung entspricht den Anforderungen voll.","bogen":"Du beteiligst dich konstant gut. Du verstehst auch schwierige Sachverhalte, ordnest sie in den Gesamtzusammenhang des Themas ein und unterscheidest Wesentliches von Unwesentlichem. Deine Kenntnisse reichen zum Teil über den Unterrichtsstoff hinaus, du kennst Fachbegriffe und wendest sie an. Du zeigst konstantes Interesse am Fach."},"3":{"word":"befriedigend","nvo":"Die Leistung entspricht im Allgemeinen den Anforderungen.","bogen":"Du bringst dich im Großen und Ganzen freiwillig ein. Fakten und Zusammenhänge aus dem behandelten Stoff gibst du im Wesentlichen richtig wieder, die Verknüpfung mit der gesamten Unterrichtseinheit gelingt meist. Einfache Fachbegriffe kennst du und wendest sie meist an. Du zeigst im Großen und Ganzen Interesse am Fach."},"4":{"word":"ausreichend","nvo":"Die Leistung weist zwar Mängel auf, entspricht im Ganzen aber den Anforderungen noch.","bogen":"Du bringst dich nur gelegentlich freiwillig ein. Deine Beiträge beschränken sich auf einfache Fakten und Zusammenhänge aus dem gerade behandelten Stoff und sind im Wesentlichen richtig. Selbst bei einfachen Fachbegriffen gibt es Lücken. Du zeigst gelegentlich Interesse am Fach."},"5":{"word":"mangelhaft","nvo":"Die Leistung entspricht den Anforderungen nicht, die notwendigen Grundkenntnisse sind aber vorhanden; die Mängel können in absehbarer Zeit behoben werden.","bogen":"Du bringst dich kaum freiwillig ein. Beiträge nach Aufforderung sind ansatzweise richtig, wesentliche Kenntnisse sind nur im Ansatz vorhanden und auch bei der Wiedergabe unsicher. Es fehlt Wissen über einfache Fachbegriffe, und du zeigst geringes Interesse am Fach."},"6":{"word":"ungenügend","nvo":"Die Leistung entspricht den Anforderungen nicht, und selbst die Grundkenntnisse sind so lückenhaft, dass die Mängel in absehbarer Zeit nicht behoben werden können.","bogen":"Du bringst dich nicht freiwillig ein, Beiträge nach Aufforderung fehlen oder sind falsch. Kenntnisse und Fertigkeiten sind nicht erkennbar, und du zeigst kein Interesse am Fach."}},"texte":{"titelEingabe":"Selbsteinschätzung: Meine mündliche Leistung","titel":"Selbsteinschätzung: Meine mündliche Leistung","infoEingabe":"<p>Schätze ein, wie du dich in diesem Halbjahr im Unterricht einbringst. Denke dabei an die letzten Wochen insgesamt, nicht an einzelne besonders gute oder schlechte Stunden.</p><p>Nach dem Speichern erhältst du eine Rückmeldung, welcher Punktzahl deine Angaben ungefähr entsprechen. <strong>Deinen Eintrag sehen nur du und dein Fachlehrer.</strong> Ehrliche Angaben bringen dir deshalb am meisten.</p>","infoListe":"<p>Hier stehen deine Selbsteinschätzungen. Nur du und dein Fachlehrer sehen sie. Mit „Eintrag hinzufügen“ legst du eine neue Einschätzung an, zum Beispiel einmal pro Halbjahr. So siehst du, wie du dich entwickelst.</p>","spalteHalbjahr":"Halbjahr","abweichungTitel":"Spontane Erwartung im Vergleich zum Ergebnis in Punkten (+ = spontan besser eingeschätzt)","bogenTitel":"So beschreibt der Kriterienbogen diese Note","kappung":"Deine Angaben zur Qualität deiner Beiträge ergäben rechnerisch {raw}. Du beteiligst dich nach eigener Angabe aber „{freq}“. Eine mündliche Leistung muss man im Unterricht auch regelmäßig zeigen: Bei dieser Häufigkeit liegt die Einordnung bei höchstens {capKurz} Punkten. Hier liegt dein größter Hebel.","vergleich":"Vor dem Ausfüllen hast du dir spontan {exp} gegeben.","vergleichPasst":"Das passt gut zu deinen Einzelangaben.","vergleichHoeher":"Das sind {n} mehr, als deine Einzelangaben ergeben. Überlege, woran du deine spontane Einschätzung festgemacht hast, und sprich gegebenenfalls mit deinem Fachlehrer darüber.","vergleichNiedriger":"Deine Einzelangaben ergeben {n} mehr. Möglicherweise schätzt du dich spontan zu streng ein.","ansatzpunkte":"Hier schätzt du dich selbst niedrig ein:","druckAbweichung":"Abw. = spontane Erwartung minus Ergebnis.","druckRechnerisch":"„rechn.“ = rechnerischer Wert vor der Begrenzung durch die Beteiligungshäufigkeit.","dateiname":"selbsteinschaetzung","gleicheAntwort":"Du hast bei allen Aussagen dieselbe Antwort gewählt ({antwort}). Dann sagt die Auswertung wenig darüber aus, wo deine Stärken und Schwächen liegen. Überlege bei jeder Aussage noch einmal einzeln und bearbeite deinen Eintrag, wenn du etwas ändern möchtest.","kappungEntwicklung":"{bereich}: Mehr Regelmäßigkeit bringt dir hier am meisten.","kappungKurz":"Begrenzt durch die Beteiligungshäufigkeit"},"farbschema":"schwarz","massstab":"normal"}},{"id":"einstellbar/mittelstufe","name":"Unter- und Mittelstufe (Noten mit Tendenz)","projekt":{"format":"selbsteinschaetzung-editor","version":1,"name":"Unter- und Mittelstufe (Noten mit Tendenz)","modus":"tendenz","kursLink":"LINK-ZUM-KURS","beschreibung":"<p>Mit diesem Bogen schätzt du deine mündliche Leistung selbst ein. Deinen Eintrag sehen nur du und deine Lehrkraft. Der Bogen dient nur zu deiner Selbsteinschätzung und hat keinen Einfluss auf etwaige Noten.</p>","kommentare":false,"felder":{"Fach":{"label":"Fach","beschreibung":"Fach","optionen":["Gemeinschaftskunde","Wirtschaft"]},"Halbjahr":{"label":"Klasse und Halbjahr","beschreibung":"Klasse und Halbjahr","optionen":["Klasse 5 / 1. Halbjahr","Klasse 5 / 2. Halbjahr","Klasse 6 / 1. Halbjahr","Klasse 6 / 2. Halbjahr","Klasse 7 / 1. Halbjahr","Klasse 7 / 2. Halbjahr","Klasse 8 / 1. Halbjahr","Klasse 8 / 2. Halbjahr","Klasse 9 / 1. Halbjahr","Klasse 9 / 2. Halbjahr","Klasse 10 / 1. Halbjahr","Klasse 10 / 2. Halbjahr"]},"Erwartung":{"label":"Bevor du startest: Welche Note würdest du dir spontan für deine mündliche Leistung geben?","beschreibung":"Spontane Einschätzung als Note vor dem Ausfüllen","hinweis":"Nach dem Ausfüllen vergleichst du diese Note mit dem Ergebnis."},"Beispiel":{"label":"Beschreibe einen Beitrag aus den letzten Wochen, der für deine mündliche Leistung typisch ist.","beschreibung":"Ein Beitrag aus den letzten Wochen, der für meine mündliche Leistung typisch ist","kurz":"Typischer Beitrag"},"Vorsatz":{"label":"Was nimmst du dir für die nächsten Wochen konkret vor?","beschreibung":"Was ich mir für die nächsten Wochen konkret vornehme","kurz":"Vorsatz für die nächsten Wochen"}},"skalen":[{"id":"haeufigkeit","name":"Meldehäufigkeit (A1)","stufen":["fast nie, auch wenn ich drankomme kaum etwas","selten, meistens erst wenn ich drankomme","manchmal","in den meisten Stunden","in fast jeder Stunde","in fast jeder Stunde mehrmals"],"anzeige":"absteigend","darstellung":"untereinander","niedrig":1,"nurLeitfrage":true},{"id":"haeufigkeit5","name":"Häufigkeit (5 Stufen)","stufen":["nie","selten","manchmal","oft","fast immer"],"anzeige":"aufsteigend","darstellung":"nebeneinander","niedrig":1,"nurLeitfrage":false},{"id":"koennen4","name":"Können (4 Stufen)","stufen":["kann ich noch nicht","kann ich teilweise","kann ich meistens","kann ich sicher"],"anzeige":"aufsteigend","darstellung":"nebeneinander","niedrig":1,"nurLeitfrage":false},{"id":"zustimmung","name":"Zustimmung (5 Stufen)","stufen":["stimmt nicht","stimmt selten","stimmt teilweise","stimmt meistens","stimmt genau"],"anzeige":"aufsteigend","darstellung":"nebeneinander","niedrig":1,"nurLeitfrage":false}],"bereiche":[{"key":"A","name":"Beteiligung","short":"Beteiligung","weight":25,"frage":"Wie regelmäßig und von dir aus machst du mit?","tips":["Nimm dir für jede Stunde vor, dich mindestens einmal zu melden, zum Beispiel am Stundenanfang.","Melde dich auch, wenn du dir nicht ganz sicher bist. Auch eine Frage ist ein guter Beitrag.","Schau dir vor der Stunde kurz an, was in der letzten Stunde dran war. Dann kannst du gleich zu Beginn mitmachen."],"items":[{"code":"A1","text":"Wie oft melde ich mich freiwillig im Unterricht?","hinweis":"Denke an die letzten Wochen, nicht an einzelne Stunden.","skala":"haeufigkeit","grenzen":[2,5,8,11,13,14]},{"code":"A2","text":"Ich melde mich auch bei schwierigen Fragen, ohne dass ich aufgerufen werde.","skala":"haeufigkeit5"},{"code":"A3","text":"Ich mache in allen Stunden mit, nicht nur bei Themen, die mich besonders interessieren.","skala":"zustimmung"}]},{"key":"B","name":"Wissen und Fachbegriffe","short":"Wissen","weight":20,"frage":"Wie sicher ist dein Wissen, und wie gut nutzt du Fachbegriffe?","tips":["Schreib dir neue Fachbegriffe mit einer kurzen Erklärung auf und verwende sie bewusst in deinen Antworten.","Wiederhole nach jeder Stunde in zwei Minuten, was du gelernt hast.","Schau ab und zu Nachrichten und überlege, was davon mit dem Unterricht zu tun hat."],"items":[{"code":"B1","text":"Ich kann richtig wiedergeben, was wir in den letzten Stunden gelernt haben.","hinweis":"zum Beispiel am Stundenanfang oder bei Wiederholungen","skala":"koennen4"},{"code":"B2","text":"Ich verwende die Fachbegriffe, die wir gelernt haben, von mir aus und richtig.","hinweis":"zum Beispiel Demokratie, Gemeinderat, Angebot und Nachfrage","skala":"haeufigkeit5"},{"code":"B3","text":"Ich kann erkennen, wie neue Inhalte mit früheren Themen zusammenhängen.","skala":"koennen4"},{"code":"B4","text":"Ich weiß auch Dinge, die über den Unterricht hinausgehen, zum Beispiel aus Nachrichten oder aus meinem Alltag.","skala":"zustimmung"}]},{"key":"C","name":"Verstehen und Zusammenhänge","short":"Verstehen","weight":20,"frage":"Verstehst du, worum es geht, und erkennst du Zusammenhänge?","tips":["Lies jede Aufgabe genau und achte darauf, was verlangt ist: nennen, beschreiben, erklären oder begründen.","Frage dich bei einem Thema: Wer ist beteiligt? Was wollen die Beteiligten? Warum ist das so?","Gehe bei Materialien Schritt für Schritt vor: Worum geht es? Was ist die wichtigste Aussage? Was fällt mir auf?"],"items":[{"code":"C1","text":"Ich kann verstehen, worum es bei einer Frage geht, und Wichtiges von Unwichtigem unterscheiden.","skala":"koennen4"},{"code":"C2","text":"Ich kann erklären, wie Dinge zusammenhängen.","hinweis":"Wer ist beteiligt? Was wollen die Beteiligten? Was sind Ursachen und Folgen?","skala":"koennen4"},{"code":"C3","text":"Ich achte darauf, was in einer Aufgabe verlangt ist, und antworte passend.","hinweis":"zum Beispiel nennen, beschreiben, erklären, begründen","skala":"haeufigkeit5"},{"code":"C4","text":"Ich kann Materialien auswerten und das Wichtigste daraus erklären.","hinweis":"Texte, Bilder, Schaubilder, Tabellen, Karikaturen","skala":"koennen4"}]},{"key":"D","name":"Begründen und Mitdiskutieren","short":"Begründen","weight":20,"frage":"Begründest du deine Meinung, und gehst du auf andere ein?","tips":["Sag nicht nur deine Meinung, sondern auch, warum: „Ich finde …, weil …“.","Hör deinen Mitschülern gut zu und knüpfe an: „Ich möchte ergänzen …“ oder „Ich sehe das anders, weil …“.","Überlege vor einem Urteil, was für und was gegen eine Sache spricht."],"items":[{"code":"D1","text":"Ich begründe meine Meinung und nenne dazu ein Beispiel oder einen Beleg.","skala":"haeufigkeit5"},{"code":"D2","text":"Ich gehe auf Beiträge meiner Mitschüler ein: Ich ergänze sie, frage nach oder widerspreche mit Begründung.","skala":"haeufigkeit5"},{"code":"D3","text":"Ich kann mir eine eigene Meinung bilden und dabei auch andere Sichtweisen bedenken.","hinweis":"zum Beispiel: Was ist gerecht? Was hilft am meisten? Was lässt sich umsetzen?","skala":"koennen4"}]},{"key":"E","name":"Vorbereitung und Interesse","short":"Interesse","weight":15,"frage":"Bist du vorbereitet, und bringst du eigene Ideen ein?","tips":["Bring jede Woche eine eigene Frage oder ein Beispiel aus deinem Alltag mit.","Erledige deine Hausaufgaben so, dass du in der Stunde etwas dazu sagen kannst.","Schreib dir im Unterricht Fragen auf und stelle sie, wenn es passt."],"items":[{"code":"E1","text":"Ich bringe eigene Fragen, Beispiele oder Ideen in den Unterricht ein.","skala":"haeufigkeit5"},{"code":"E2","text":"Ich bin vorbereitet (Hausaufgaben, Material), sodass ich mitmachen kann.","skala":"haeufigkeit5"},{"code":"E3","text":"Ich zeige Interesse am Fach, zum Beispiel durch Nachfragen und aufmerksames Zuhören.","skala":"haeufigkeit5"}]}],"noten":{"1":{"word":"sehr gut","nvo":"Die Leistung entspricht den Anforderungen in besonderem Maße.","bogen":"Du machst in jeder Stunde mit und bringst den Unterricht mit eigenen Fragen und Ideen voran. Du verstehst auch schwierige Inhalte, erklärst Zusammenhänge und verwendest Fachbegriffe sicher. Du begründest deine Meinung überzeugend und gehst auf andere ein. Du zeigst sehr großes Interesse am Fach."},"2":{"word":"gut","nvo":"Die Leistung entspricht den Anforderungen voll.","bogen":"Du machst regelmäßig von dir aus mit. Was wir gelernt haben, gibst du richtig wieder und verbindest es mit früheren Themen. Fachbegriffe kennst du und verwendest sie. Du begründest deine Meinung und zeigst Interesse am Fach."},"3":{"word":"befriedigend","nvo":"Die Leistung entspricht im Allgemeinen den Anforderungen.","bogen":"Du machst im Großen und Ganzen freiwillig mit. Was wir gerade gelernt haben, gibst du meistens richtig wieder. Einfache Fachbegriffe kennst du und verwendest sie meistens. Du zeigst im Großen und Ganzen Interesse am Fach."},"4":{"word":"ausreichend","nvo":"Die Leistung weist zwar Mängel auf, entspricht im Ganzen aber den Anforderungen noch.","bogen":"Du meldest dich nur manchmal von dir aus. Deine Beiträge beziehen sich meist auf einfache Inhalte aus der letzten Stunde und sind im Wesentlichen richtig. Bei Fachbegriffen gibt es noch Lücken. Du zeigst manchmal Interesse am Fach."},"5":{"word":"mangelhaft","nvo":"Die Leistung entspricht den Anforderungen nicht, die notwendigen Grundkenntnisse sind aber vorhanden; die Mängel können in absehbarer Zeit behoben werden.","bogen":"Du meldest dich kaum von dir aus. Wenn du drankommst, sind deine Antworten nur teilweise richtig, und es fehlen wichtige Grundlagen und Fachbegriffe. Du zeigst wenig Interesse am Fach."},"6":{"word":"ungenügend","nvo":"Die Leistung entspricht den Anforderungen nicht, und selbst die Grundkenntnisse sind so lückenhaft, dass die Mängel in absehbarer Zeit nicht behoben werden können.","bogen":"Du meldest dich nicht von dir aus. Wenn du drankommst, fehlen Antworten oder sie sind falsch. Kenntnisse sind kaum erkennbar, und du zeigst kein Interesse am Fach."}},"texte":{"titelEingabe":"Selbsteinschätzung: Meine mündliche Leistung","titel":"Selbsteinschätzung: Meine mündliche Leistung","infoEingabe":"<p>Schätze ein, wie du dich in diesem Halbjahr im Unterricht einbringst. Denke dabei an die letzten Wochen insgesamt, nicht an einzelne besonders gute oder schlechte Stunden.</p><p>Nach dem Speichern erhältst du eine Rückmeldung, welcher Note deine Angaben ungefähr entsprechen. <strong>Deinen Eintrag sehen nur du und dein Fachlehrer.</strong> Ehrliche Angaben bringen dir deshalb am meisten.</p>","infoListe":"<p>Hier stehen deine Selbsteinschätzungen. Nur du und dein Fachlehrer sehen sie. Mit „Eintrag hinzufügen“ legst du eine neue Einschätzung an, zum Beispiel einmal pro Halbjahr. So siehst du, wie du dich entwickelst.</p>","spalteHalbjahr":"Klasse / Halbjahr","abweichungTitel":"Spontane Erwartung im Vergleich zum Ergebnis in Teilnotenstufen (+ = spontan besser eingeschätzt)","bogenTitel":"Das bedeutet diese Note für deine mündliche Leistung","kappung":"Deine Angaben zur Qualität deiner Beiträge ergäben rechnerisch {raw}. Du meldest dich nach eigener Angabe aber „{freq}“. Mündliche Leistung muss man im Unterricht auch regelmäßig zeigen: Bei dieser Häufigkeit ist höchstens {cap} möglich. Hier kannst du am meisten verbessern.","vergleich":"Vor dem Ausfüllen hast du dir spontan {exp} gegeben.","vergleichPasst":"Das passt gut zu deinen Einzelangaben.","vergleichHoeher":"Deine Einzelangaben ergeben eine {res}, also {n} schlechter. Überlege, woran du deine spontane Einschätzung festgemacht hast, und sprich gegebenenfalls mit deinem Fachlehrer darüber.","vergleichNiedriger":"Deine Einzelangaben ergeben eine {res}, also {n} besser. Möglicherweise schätzt du dich spontan zu streng ein.","ansatzpunkte":"Hier schätzt du dich selbst niedrig ein:","druckAbweichung":"Abw. = Unterschied zwischen spontaner Erwartung und Ergebnis in Teilnotenstufen (+ = spontan besser eingeschätzt).","druckRechnerisch":"„rechn.“ = rechnerische Note vor der Begrenzung durch die Beteiligungshäufigkeit.","dateiname":"selbsteinschaetzung-unter-mittelstufe","gleicheAntwort":"Du hast bei allen Aussagen dieselbe Antwort gewählt ({antwort}). Dann sagt die Auswertung wenig darüber aus, wo deine Stärken und Schwächen liegen. Überlege bei jeder Aussage noch einmal einzeln und bearbeite deinen Eintrag, wenn du etwas ändern möchtest.","kappungEntwicklung":"{bereich}: Mehr Regelmäßigkeit bringt dir hier am meisten.","kappungKurz":"Begrenzt durch die Beteiligungshäufigkeit"},"farbschema":"schwarz","massstab":"normal"}},{"id":"fremdsprachen-raster-oberstufe","name":"Fremdsprachen Kriterienraster Oberstufe (Punkte 0–15)","projekt":{"format":"selbsteinschaetzung-editor","version":1,"name":"Fremdsprachen Kriterienraster Oberstufe (Punkte 0–15)","modus":"punkte","kursLink":"LINK-ZUM-KURS","beschreibung":"<p>Mit diesem Bogen schätzt du deine mündliche Leistung in der Fremdsprache selbst ein. Grundlage sind die Kriterien für mündliche Noten der Fachschaften moderne Fremdsprachen. Der Bogen dient nur zu deiner Selbsteinschätzung und hat keinen Einfluss auf etwaige Noten.</p>","kommentare":false,"felder":{"Fach":{"label":"Fach","beschreibung":"Fach","optionen":["Englisch","Französisch","Spanisch"]},"Halbjahr":{"label":"Halbjahr","beschreibung":"Kurshalbjahr","optionen":["J1 / 1. Halbjahr","J1 / 2. Halbjahr","J2 / 1. Halbjahr","J2 / 2. Halbjahr"]},"Erwartung":{"label":"Bevor du startest: Wie viele Punkte würdest du dir spontan für deine mündliche Leistung geben?","beschreibung":"Spontane Einschätzung in Punkten vor dem Ausfüllen","hinweis":"Nach dem Ausfüllen vergleichst du diese Zahl mit dem Ergebnis."},"Beispiel":{"label":"Beschreibe einen Beitrag aus den letzten Wochen, der für deine mündliche Leistung typisch ist.","beschreibung":"Ein Beitrag aus den letzten Wochen, der für meine mündliche Leistung typisch ist","kurz":"Typischer Beitrag"},"Vorsatz":{"label":"Was nimmst du dir für die nächsten Wochen konkret vor?","beschreibung":"Was ich mir für die nächsten Wochen konkret vornehme","kurz":"Vorsatz für die nächsten Wochen"}},"skalen":[{"id":"haeufigkeit","name":"Meldehäufigkeit (A1)","stufen":["nie, auch nach Aufforderung kaum","selten, meist erst nach Aufforderung","gelegentlich","in den meisten Stunden","in fast jeder Stunde","in fast jeder Stunde mehrfach"],"anzeige":"absteigend","darstellung":"untereinander","niedrig":1,"nurLeitfrage":true},{"id":"haeufigkeit5","name":"Häufigkeit (5 Stufen)","stufen":["nie","selten","manchmal","oft","fast immer"],"anzeige":"aufsteigend","darstellung":"nebeneinander","niedrig":1,"nurLeitfrage":false}],"bereiche":[{"key":"A","name":"Sprechen","short":"Sprechen","weight":30,"frage":"Wie selbstständig sprichst du im Unterricht in der Fremdsprache?","tips":["Nimm dir für jede Stunde mindestens einen Beitrag in der Fremdsprache vor, zum Beispiel beim Stundeneinstieg.","Übe kurze Vorträge: eine Minute zu einem Thema mit drei Stichwörtern, laut, zu Hause.","Lege dir Redemittel zum Begründen, Widersprechen und Nachfragen an und verwende sie bewusst."],"items":[{"code":"A1","text":"An Gesprächen teilnehmen: Welche Beschreibung passt am besten zu dir?","raster":["Ich beteilige mich in fast jeder Stunde spontan an Diskussionen, auch bei neuen und schwierigen Themen. Ich gehe genau auf andere ein, bringe das Gespräch voran und wechsle dabei nicht ins Deutsche.","Ich beteilige mich regelmäßig an Diskussionen, auch ohne Vorbereitung, und gehe auf Beiträge anderer ein. Nur bei schwierigen Themen brauche ich etwas Zeit.","Ich beteilige mich an Gesprächen über vertraute Themen. Bei neuen Themen antworte ich eher kurz.","Ich antworte meist nur auf direkte Fragen, oft mit kurzen oder auswendig gelernten Sätzen.","Ich äußere mich selten und meist nur, wenn ich aufgerufen werde. Dann antworte ich sehr knapp oder wechsle ins Deutsche.",""]},{"code":"A2","text":"Zusammenhängend sprechen: Welche Beschreibung passt am besten zu dir?","raster":["Ich spreche frei, überzeugend und klar gegliedert, auch über anspruchsvolle Themen. Ich begründe meine Position differenziert und gehe sicher auf Rückfragen ein.","Ich spreche weitgehend frei und gut gegliedert und begründe meine Meinung mit Beispielen. Stichwortnotizen reichen mir als Stütze.","Ich spreche mit Notizen über ein vorbereitetes Thema. Der Aufbau ist erkennbar, die Begründungen bleiben knapp.","Ich trage vorbereitete Sätze vor und lese dabei überwiegend ab.","Ich lese auch vorbereitete Texte nur stockend ab und komme ohne Hilfe kaum über einzelne Sätze hinaus.",""],"hinweis":"zum Beispiel Präsentation, Bericht, Stellungnahme"}]},{"key":"B","name":"Verstehen","short":"Verstehen","weight":10,"frage":"Wie viel verstehst du, wenn im Unterricht in der Fremdsprache gesprochen wird?","tips":["Höre regelmäßig Podcasts, Serien oder Nachrichten in der Fremdsprache, zuerst mit, dann ohne Untertitel.","Achte beim Hören zuerst auf das Wesentliche: Wer? Was? Warum? Einzelheiten kommen beim zweiten Hören.","Frage nach, wenn du etwas nicht verstehst. Auch das ist ein Beitrag in der Fremdsprache."],"items":[{"code":"B1","text":"Verstehen: Welche Beschreibung passt am besten zu dir?","raster":["Ich verstehe auch lange und schnelle Beiträge und authentische Hör- und Filmtexte mit unbekannten Wörtern vollständig, auch Einzelheiten und Zwischentöne.","Ich verstehe Unterrichtsgespräche und authentische Hörtexte zu bekannten Themen auch in Einzelheiten. Nachfragen muss ich nur selten.","Ich verstehe das Wesentliche, wenn deutlich und über vertraute Themen gesprochen wird.","Ich verstehe einzelne Aussagen und brauche oft eine Wiederholung oder eine Erklärung auf Deutsch.","Ich verstehe auch bei vertrauten Themen oft nur Bruchstücke und brauche meist eine Erklärung auf Deutsch.",""],"hinweis":"Lehrkraft, Mitschüler, Hör- und Filmtexte"}]},{"key":"C","name":"Sprachliche Mittel","short":"Sprache","weight":25,"frage":"Wie treffend und wie richtig drückst du dich aus?","tips":["Notiere neue Wörter immer mit einem Beispielsatz oder einer typischen Wortverbindung und verwende sie in den nächsten Stunden bewusst.","Achte darauf, welche Fehler du immer wieder machst, und konzentriere dich beim Sprechen gezielt auf einen davon.","Höre regelmäßig Podcasts, Serien oder Nachrichten in der Fremdsprache und sprich einzelne Sätze laut nach."],"items":[{"code":"C1","text":"Wortschatz und Ausdruck: Welche Beschreibung passt am besten zu dir?","raster":["Ich drücke mich präzise und abwechslungsreich aus und verwende auch idiomatische Wendungen sicher. Fehlende Wörter umschreibe ich so, dass es kaum auffällt.","Ich verwende den Wortschatz der Einheit sicher und abwechslungsreich und kann fehlende Wörter fast immer umschreiben.","Ich komme mit einem Grundwortschatz zurecht. Manchmal suche ich nach Wörtern oder wechsle ins Deutsche.","Mir fehlen oft Wörter. Ich sage dann nur Einfaches oder wechsle ins Deutsche.","Mir fehlen so viele Wörter, dass ich nur sehr Einfaches ausdrücken kann.",""]},{"code":"C2","text":"Sprachliche Richtigkeit: Welche Beschreibung passt am besten zu dir?","raster":["Ich spreche auch in komplexen Sätzen nahezu fehlerfrei. Aussprache und Betonung sind klar und natürlich.","Ich mache nur selten Fehler, auch bei schwierigeren Strukturen, und korrigiere die meisten selbst. Meine Aussprache ist klar.","Ich mache Fehler, vor allem bei schwierigeren Strukturen. Man versteht mich trotzdem.","Fehler oder Aussprache erschweren das Verstehen. Andere müssen manchmal nachfragen.","Ich mache auch in einfachen Sätzen viele Fehler, sodass andere oft nachfragen müssen.",""],"hinweis":"Grammatik und Aussprache"}]},{"key":"D","name":"Arbeit mit Texten und Themen","short":"Inhalt","weight":20,"frage":"Wie gründlich arbeitest du mit Texten und Themen?","tips":["Stütze jede Aussage mit einem Beleg oder Beispiel, etwa einer Textstelle.","Frage dich bei einem Text: Was wird gesagt, wie wird es gesagt, und mit welcher Absicht?","Knüpfe ausdrücklich an andere an, zum Beispiel mit Redemitteln für „Ich möchte ergänzen …“ oder „Ich sehe das anders, weil …“."],"items":[{"code":"D1","text":"Arbeit mit Texten und Themen: Welche Beschreibung passt am besten zu dir?","raster":["Ich deute Texte und Themen eigenständig und differenziert, beziehe Hintergründe und Gegenpositionen ein und begründe ein eigenes, abgewogenes Urteil.","Ich analysiere Texte genau (Aufbau, Absicht, Wirkung), belege meine Aussagen am Text und komme zu einer begründeten Meinung.","Ich gebe Inhalte richtig wieder und erkläre einfache Zusammenhänge.","Ich gebe Inhalte nur teilweise oder lückenhaft wieder.","Ich gebe Inhalte meist nur in Bruchstücken oder ungenau wieder.",""]}]},{"key":"E","name":"Mitarbeit und Arbeitsweise","short":"Mitarbeit","weight":15,"frage":"Wie regelmäßig machst du mit, und wie arbeitest du mit anderen?","tips":["Übernimm in der nächsten Gruppenarbeit bewusst eine Aufgabe, etwa die Gesprächsleitung oder die Präsentation.","Vereinbart zu Beginn der Gruppenarbeit, dass ihr in der Fremdsprache sprecht.","Lerne Vokabeln in kleinen Portionen über die Woche verteilt und bring pro Woche eine eigene Idee oder Frage mit."],"items":[{"code":"E1","text":"Wie oft beteilige ich mich freiwillig am Unterrichtsgespräch?","hinweis":"Denke an die letzten Wochen, nicht an einzelne Stunden.","skala":"haeufigkeit","grenzen":[2,5,8,11,13,15]},{"code":"E2","text":"Partner- und Gruppenarbeit: Welche Beschreibung passt am besten zu dir?","raster":["Ich leite die Gruppe an, spreche durchgehend in der Fremdsprache, bringe die Arbeit inhaltlich voran und helfe anderen beim Formulieren.","Ich arbeite aktiv und zuverlässig mit, bringe eigene Ideen ein und spreche fast immer in der Fremdsprache.","Ich arbeite mit, wechsle aber oft ins Deutsche.","Ich arbeite vor allem mit, wenn andere mich ansprechen, und spreche meist Deutsch.","Ich beteilige mich wenig an der gemeinsamen Arbeit und spreche fast nur Deutsch.",""]},{"code":"E3","text":"Ich bin vorbereitet: Ich habe Vokabeln gelernt, Hausaufgaben erledigt und Texte gelesen.","skala":"haeufigkeit5"},{"code":"E4","text":"Ich bringe eigene Ideen, Fragen oder Beispiele ein, die den Unterricht voranbringen.","skala":"haeufigkeit5"}]}],"noten":{"1":{"word":"sehr gut","nvo":"Die Leistung entspricht den Anforderungen in besonderem Maße.","bogen":"Du beteiligst dich spontan an Gesprächen, sprichst frei und gut gegliedert und verstehst auch anspruchsvolle Hör- und Filmtexte im Detail. Du drückst dich treffend und weitgehend fehlerfrei aus. Texte deutest du eigenständig und begründest ein eigenes Urteil. In der Gruppenarbeit bringst du die anderen voran und sprichst durchgehend in der Fremdsprache."},"2":{"word":"gut","nvo":"Die Leistung entspricht den Anforderungen voll.","bogen":"Du beteiligst dich an Diskussionen, sprichst zusammenhängend und begründest deine Meinung. Du verstehst Unterrichtsgespräche und die meisten Hörtexte. Den Wortschatz der Einheit verwendest du sicher, Fehler stören das Verstehen nicht. Texte analysierst du und belegst deine Aussagen. In der Gruppenarbeit arbeitest du aktiv mit, überwiegend in der Fremdsprache."},"3":{"word":"befriedigend","nvo":"Die Leistung entspricht im Allgemeinen den Anforderungen.","bogen":"Du beteiligst dich an Gesprächen über vertraute Themen und sprichst mit Notizen über vorbereitete Themen. Das Wesentliche verstehst du. Du kommst mit einem Grundwortschatz zurecht und machst Fehler, man versteht dich aber. Inhalte gibst du richtig wieder und erklärst einfache Zusammenhänge. In der Gruppenarbeit machst du mit, wechselst aber oft ins Deutsche."},"4":{"word":"ausreichend","nvo":"Die Leistung weist zwar Mängel auf, entspricht aber im Ganzen noch den Anforderungen.","bogen":"Du antwortest meist nur auf direkte Fragen und trägst vorbereitete Sätze vor. Du verstehst einzelne Aussagen und brauchst oft Hilfe. Dir fehlen häufig Wörter, und Fehler erschweren das Verstehen. Inhalte gibst du nur lückenhaft wieder. In der Gruppenarbeit sprichst du meist Deutsch."},"5":{"word":"mangelhaft","nvo":"Die Leistung entspricht den Anforderungen nicht, lässt jedoch erkennen, dass die notwendigen Grundkenntnisse vorhanden sind und die Mängel in absehbarer Zeit behoben werden können.","bogen":"Du äußerst dich in der Fremdsprache kaum und meist nur mit einzelnen Wörtern. Du verstehst wenig, und wegen vieler Fehler versteht man dich oft nicht. Inhalte kannst du kaum wiedergeben, an der gemeinsamen Arbeit beteiligst du dich kaum."},"6":{"word":"ungenügend","nvo":"Die Leistung entspricht den Anforderungen nicht. Die Grundkenntnisse sind so lückenhaft, dass die Mängel in absehbarer Zeit nicht behoben werden können.","bogen":"Du äußerst dich in der Fremdsprache nicht und beteiligst dich nicht am Unterricht. Grundlegende Kenntnisse sind nicht erkennbar."}},"texte":{"titelEingabe":"Selbsteinschätzung: Meine mündliche Leistung in der Fremdsprache","titel":"Selbsteinschätzung: Meine mündliche Leistung in der Fremdsprache","infoEingabe":"<p>Wähle bei jedem Merkmal die Beschreibung, die in diesem Halbjahr am besten auf dich zutrifft. Denke an die letzten Wochen insgesamt, nicht an einzelne besonders gute oder schlechte Stunden. Am Ende stehen drei Fragen dazu, wie oft du etwas tust.</p><p>Nach dem Speichern erhältst du eine Rückmeldung, welcher Punktzahl deine Angaben ungefähr entsprechen. <strong>Deinen Eintrag sehen nur du und dein Fachlehrer.</strong> Ehrliche Angaben bringen dir deshalb am meisten.</p>","infoListe":"<p>Hier stehen deine Selbsteinschätzungen. Nur du und dein Fachlehrer sehen sie. Mit „Eintrag hinzufügen“ legst du eine neue Einschätzung an, zum Beispiel einmal pro Halbjahr. So siehst du, wie du dich entwickelst.</p>","spalteHalbjahr":"Halbjahr","abweichungTitel":"Spontane Erwartung im Vergleich zum Ergebnis in Punkten (+ = spontan besser eingeschätzt)","bogenTitel":"So beschreibt das Kriterienraster diese Note","kappung":"Deine Angaben zur Qualität deiner Beiträge ergäben rechnerisch {raw}. Du beteiligst dich nach eigener Angabe aber „{freq}“. Eine mündliche Leistung muss man im Unterricht auch regelmäßig zeigen: Bei dieser Häufigkeit liegt die Einordnung bei höchstens {capKurz} Punkten. Hier liegt dein größter Hebel.","vergleich":"Vor dem Ausfüllen hast du dir spontan {exp} gegeben.","vergleichPasst":"Das passt gut zu deinen Einzelangaben.","vergleichHoeher":"Das sind {n} mehr, als deine Einzelangaben ergeben. Überlege, woran du deine spontane Einschätzung festgemacht hast, und sprich gegebenenfalls mit deinem Fachlehrer darüber.","vergleichNiedriger":"Deine Einzelangaben ergeben {n} mehr. Möglicherweise schätzt du dich spontan zu streng ein.","ansatzpunkte":"Hier schätzt du dich selbst niedrig ein:","druckAbweichung":"Abw. = spontane Erwartung minus Ergebnis.","druckRechnerisch":"„rechn.“ = rechnerischer Wert vor der Begrenzung durch die Beteiligungshäufigkeit.","dateiname":"selbsteinschaetzung-fremdsprachen-raster-oberstufe","gleicheAntwort":"Du hast bei allen Aussagen dieselbe Antwort gewählt ({antwort}). Dann sagt die Auswertung wenig darüber aus, wo deine Stärken und Schwächen liegen. Überlege bei jeder Aussage noch einmal einzeln und bearbeite deinen Eintrag, wenn du etwas ändern möchtest.","kappungEntwicklung":"{bereich}: Mehr Regelmäßigkeit bringt dir hier am meisten.","kappungKurz":"Begrenzt durch die Beteiligungshäufigkeit"},"farbschema":"schwarz","massstab":"normal"}},{"id":"fremdsprachen-raster-mittelstufe","name":"Fremdsprachen Kriterienraster Klasse 5–10 (Noten mit Tendenz)","projekt":{"format":"selbsteinschaetzung-editor","version":1,"name":"Fremdsprachen Kriterienraster Klasse 5–10 (Noten mit Tendenz)","modus":"tendenz","kursLink":"LINK-ZUM-KURS","beschreibung":"<p>Mit diesem Bogen schätzt du deine mündliche Leistung in der Fremdsprache selbst ein. Grundlage sind die Kriterien für mündliche Noten der Fachschaften moderne Fremdsprachen. Der Bogen dient nur zu deiner Selbsteinschätzung und hat keinen Einfluss auf etwaige Noten.</p>","kommentare":false,"felder":{"Fach":{"label":"Fach","beschreibung":"Fach","optionen":["Englisch","Französisch","Spanisch"]},"Halbjahr":{"label":"Klasse und Halbjahr","beschreibung":"Klasse und Halbjahr","optionen":["Klasse 5 / 1. Halbjahr","Klasse 5 / 2. Halbjahr","Klasse 6 / 1. Halbjahr","Klasse 6 / 2. Halbjahr","Klasse 7 / 1. Halbjahr","Klasse 7 / 2. Halbjahr","Klasse 8 / 1. Halbjahr","Klasse 8 / 2. Halbjahr","Klasse 9 / 1. Halbjahr","Klasse 9 / 2. Halbjahr","Klasse 10 / 1. Halbjahr","Klasse 10 / 2. Halbjahr"]},"Erwartung":{"label":"Bevor du startest: Welche Note würdest du dir spontan für deine mündliche Leistung geben?","beschreibung":"Spontane Einschätzung als Note vor dem Ausfüllen","hinweis":"Nach dem Ausfüllen vergleichst du diese Note mit dem Ergebnis."},"Beispiel":{"label":"Beschreibe einen Beitrag aus den letzten Wochen, der für deine mündliche Leistung typisch ist.","beschreibung":"Ein Beitrag aus den letzten Wochen, der für meine mündliche Leistung typisch ist","kurz":"Typischer Beitrag"},"Vorsatz":{"label":"Was nimmst du dir für die nächsten Wochen konkret vor?","beschreibung":"Was ich mir für die nächsten Wochen konkret vornehme","kurz":"Vorsatz für die nächsten Wochen"}},"skalen":[{"id":"haeufigkeit","name":"Meldehäufigkeit (A1)","stufen":["fast nie, auch wenn ich drankomme kaum etwas","selten, meistens erst wenn ich drankomme","manchmal","in den meisten Stunden","in fast jeder Stunde","in fast jeder Stunde mehrmals"],"anzeige":"absteigend","darstellung":"untereinander","niedrig":1,"nurLeitfrage":true},{"id":"haeufigkeit5","name":"Häufigkeit (5 Stufen)","stufen":["nie","selten","manchmal","oft","fast immer"],"anzeige":"aufsteigend","darstellung":"nebeneinander","niedrig":1,"nurLeitfrage":false}],"bereiche":[{"key":"A","name":"Sprechen","short":"Sprechen","weight":30,"frage":"Wie selbstständig sprichst du im Unterricht in der Fremdsprache?","tips":["Nimm dir für jede Stunde vor, mindestens einmal etwas in der Fremdsprache zu sagen, zum Beispiel am Stundenanfang.","Fehler sind beim Sprechen ganz normal. Jeder Versuch hilft dir, sicherer zu werden.","Schreib dir nützliche Sätze auf, mit denen du nachfragen oder um Hilfe bitten kannst, und benutze sie im Unterricht."],"items":[{"code":"A1","text":"Mitreden: Was passt am besten zu dir?","raster":["Ich mache in fast jeder Stunde von mir aus bei Gesprächen mit, auch bei neuen Themen, und gehe auf das ein, was andere sagen. Dabei spreche ich nur in der Fremdsprache.","Ich mache oft von mir aus bei Gesprächen mit und kann auf Fragen ausführlich antworten.","Ich antworte auf Fragen, meist kurz und mit Sätzen, die wir geübt haben.","Ich antworte nur, wenn ich gefragt werde, und brauche dabei oft Hilfe.","Ich sage in der Fremdsprache selten etwas, und dann meist nur einzelne Wörter.",""]},{"code":"A2","text":"Etwas vortragen: Was passt am besten zu dir?","raster":["Ich kann frei, flüssig und gut verständlich über ein Thema sprechen, ohne abzulesen.","Ich kann mit wenigen Stichwörtern zusammenhängend über ein Thema sprechen.","Ich kann vorbereitete Sätze vortragen, einen Teil lese ich ab.","Ich lese vorbereitete Sätze fast nur ab.","Auch mit Vorbereitung kann ich nur einzelne Sätze sagen und brauche dabei Hilfe.",""],"hinweis":"zum Beispiel etwas vorstellen, erzählen oder beschreiben"}]},{"key":"B","name":"Verstehen","short":"Verstehen","weight":10,"frage":"Wie viel verstehst du, wenn im Unterricht in der Fremdsprache gesprochen wird?","tips":["Hör dir Lieder, Videos oder Hörtexte in der Fremdsprache an, gern mehrmals.","Achte beim Hören zuerst auf das Wichtigste: Wer? Was? Wo?","Frag nach, wenn du etwas nicht verstehst, zum Beispiel mit einem Satz in der Fremdsprache."],"items":[{"code":"B1","text":"Verstehen: Was passt am besten zu dir?","raster":["Ich verstehe fast alles, auch wenn schnell gesprochen wird, und auch neue Hörtexte und Videos.","Ich verstehe das meiste im Unterricht und in Hörtexten, auch Einzelheiten.","Ich verstehe das Wichtigste. Manchmal brauche ich eine Wiederholung.","Ich verstehe einzelne Sätze und brauche oft eine Wiederholung.","Ich verstehe oft nur einzelne Wörter und brauche meist eine Erklärung auf Deutsch.",""],"hinweis":"Lehrkraft, Mitschüler, Hörtexte und Videos"}]},{"key":"C","name":"Wörter, Grammatik und Aussprache","short":"Sprache","weight":25,"frage":"Wie gut kennst du die Wörter, und wie richtig sprichst du?","tips":["Lerne neue Wörter immer mit einem Beispielsatz und benutze sie in den nächsten Stunden.","Achte darauf, welcher Fehler dir oft passiert, und übe genau diesen.","Hör dir Lieder, Videos oder Hörtexte in der Fremdsprache an und sprich einzelne Sätze laut nach."],"items":[{"code":"C1","text":"Wörter: Was passt am besten zu dir?","raster":["Ich kenne die Wörter der Lektion sicher, verwende auch schwierige Wörter und finde immer eine Umschreibung, wenn mir ein Wort fehlt.","Ich kenne fast alle Wörter der Lektion und kann sie richtig verwenden.","Ich kenne die wichtigsten Wörter. Manchmal fehlt mir eins, dann spreche ich Deutsch.","Mir fehlen oft Wörter, dann sage ich nur Einfaches oder spreche Deutsch.","Mir fehlen so viele Wörter, dass ich nur sehr wenig sagen kann.",""]},{"code":"C2","text":"Richtig sprechen: Was passt am besten zu dir?","raster":["Ich spreche fast fehlerfrei und deutlich, auch mit dem, was wir gerade neu gelernt haben.","Ich mache selten Fehler, auch beim neuen Stoff, und man versteht mich gut.","Ich mache öfter Fehler, man versteht mich aber.","Ich mache viele Fehler, manchmal muss jemand nachfragen.","Ich mache auch in einfachen Sätzen viele Fehler, sodass man mich oft nicht versteht.",""],"hinweis":"Grammatik und Aussprache"}]},{"key":"D","name":"Texte und Themen","short":"Inhalt","weight":20,"frage":"Verstehst du Texte, und sagst du etwas Eigenes dazu?","tips":["Sag nicht nur deine Meinung, sondern auch, warum. Lerne dafür ein paar Satzanfänge in der Fremdsprache auswendig.","Überlege nach dem Lesen oder Hören: Worum geht es? Was ist das Wichtigste? Was denke ich darüber?","Hör deinen Mitschülern gut zu und knüpfe an ihre Beiträge an."],"items":[{"code":"D1","text":"Texte und Themen: Was passt am besten zu dir?","raster":["Ich verstehe Texte genau, gebe den Inhalt vollständig wieder und begründe meine Meinung mit Beispielen aus dem Text.","Ich gebe den Inhalt von Texten richtig und vollständig wieder und sage, was ich darüber denke.","Ich gebe das Wichtigste aus einem Text richtig wieder.","Ich gebe den Inhalt von Texten nur teilweise wieder.","Ich gebe vom Inhalt eines Textes nur wenig richtig wieder.",""]}]},{"key":"E","name":"Mitarbeit und Arbeitsweise","short":"Mitarbeit","weight":15,"frage":"Wie regelmäßig machst du mit, und wie arbeitest du mit anderen?","tips":["Übernimm bei der nächsten Gruppenarbeit eine Aufgabe, zum Beispiel das Vorstellen der Ergebnisse.","Sprecht ab, dass ihr in der Fremdsprache redet, und erinnert euch gegenseitig daran.","Lerne Vokabeln jeden Tag ein paar Minuten, statt alles am Abend vor dem Test."],"items":[{"code":"E1","text":"Wie oft melde ich mich freiwillig im Unterricht?","hinweis":"Denke an die letzten Wochen, nicht an einzelne Stunden.","skala":"haeufigkeit","grenzen":[2,5,8,11,13,14]},{"code":"E2","text":"Partner- und Gruppenarbeit: Was passt am besten zu dir?","raster":["Ich bringe unsere Gruppe voran, helfe anderen und spreche dabei die ganze Zeit in der Fremdsprache.","Ich mache aktiv mit, bringe Ideen ein und spreche fast immer in der Fremdsprache.","Ich mache mit, spreche aber oft Deutsch.","Ich mache nur mit, wenn andere mich ansprechen, und spreche meist Deutsch.","Ich mache bei der gemeinsamen Arbeit wenig mit und spreche fast nur Deutsch.",""]},{"code":"E3","text":"Ich bin vorbereitet: Ich habe meine Vokabeln gelernt und meine Hausaufgaben gemacht.","skala":"haeufigkeit5"},{"code":"E4","text":"Ich bringe eigene Ideen, Fragen oder Beispiele in den Unterricht ein.","skala":"haeufigkeit5"}]}],"noten":{"1":{"word":"sehr gut","nvo":"Die Leistung entspricht den Anforderungen in besonderem Maße.","bogen":"Du machst in Gesprächen von dir aus mit, sprichst frei über Themen und verstehst fast alles. Du kennst die Wörter sicher und sprichst fast fehlerfrei. Texte verstehst du genau und sagst deine Meinung mit Begründung. In der Gruppe bringst du die anderen voran und sprichst die ganze Zeit in der Fremdsprache."},"2":{"word":"gut","nvo":"Die Leistung entspricht den Anforderungen voll.","bogen":"Du machst bei Gesprächen mit und kannst mit Stichwörtern über ein Thema sprechen. Du verstehst das meiste und kennst die meisten Wörter. Fehler machst du ab und zu, man versteht dich gut. In der Gruppe machst du aktiv mit und sprichst meistens in der Fremdsprache."},"3":{"word":"befriedigend","nvo":"Die Leistung entspricht im Allgemeinen den Anforderungen.","bogen":"Du antwortest auf Fragen und trägst vorbereitete Sätze vor. Das Wichtigste verstehst du. Du kennst die wichtigsten Wörter und machst öfter Fehler, man versteht dich aber. In der Gruppe machst du mit, sprichst aber oft Deutsch."},"4":{"word":"ausreichend","nvo":"Die Leistung weist zwar Mängel auf, entspricht aber im Ganzen noch den Anforderungen.","bogen":"Du sagst meist nur etwas, wenn du drankommst, und verstehst oft nur mit Hilfe. Dir fehlen häufig Wörter, und deine Fehler erschweren das Verstehen. In der Gruppe sprichst du meistens Deutsch."},"5":{"word":"mangelhaft","nvo":"Die Leistung entspricht den Anforderungen nicht, lässt jedoch erkennen, dass die notwendigen Grundkenntnisse vorhanden sind und die Mängel in absehbarer Zeit behoben werden können.","bogen":"Du sagst in der Fremdsprache kaum etwas und verstehst meist nur einzelne Wörter. Dir fehlen viele Wörter, und man versteht dich oft nicht. Bei der gemeinsamen Arbeit machst du kaum mit."},"6":{"word":"ungenügend","nvo":"Die Leistung entspricht den Anforderungen nicht. Die Grundkenntnisse sind so lückenhaft, dass die Mängel in absehbarer Zeit nicht behoben werden können.","bogen":"Du sagst in der Fremdsprache nichts und machst im Unterricht nicht mit. Grundkenntnisse sind nicht erkennbar."}},"texte":{"titelEingabe":"Selbsteinschätzung: Meine mündliche Leistung in der Fremdsprache","titel":"Selbsteinschätzung: Meine mündliche Leistung in der Fremdsprache","infoEingabe":"<p>Wähle bei jedem Punkt den Satz, der in diesem Halbjahr am besten zu dir passt. Denke an die letzten Wochen, nicht an einzelne besonders gute oder schlechte Stunden. Am Ende stehen drei Fragen dazu, wie oft du etwas tust.</p><p>Nach dem Speichern erhältst du eine Rückmeldung, welcher Note deine Angaben ungefähr entsprechen. <strong>Deinen Eintrag sehen nur du und dein Fachlehrer.</strong> Ehrliche Angaben bringen dir deshalb am meisten.</p>","infoListe":"<p>Hier stehen deine Selbsteinschätzungen. Nur du und dein Fachlehrer sehen sie. Mit „Eintrag hinzufügen“ legst du eine neue Einschätzung an, zum Beispiel einmal pro Halbjahr. So siehst du, wie du dich entwickelst.</p>","spalteHalbjahr":"Klasse / Halbjahr","abweichungTitel":"Spontane Erwartung im Vergleich zum Ergebnis in Teilnotenstufen (+ = spontan besser eingeschätzt)","bogenTitel":"Das bedeutet diese Note für deine mündliche Leistung","kappung":"Deine Angaben zur Qualität deiner Beiträge ergäben rechnerisch {raw}. Du meldest dich nach eigener Angabe aber „{freq}“. Mündliche Leistung muss man im Unterricht auch regelmäßig zeigen: Bei dieser Häufigkeit ist höchstens {cap} möglich. Hier kannst du am meisten verbessern.","vergleich":"Vor dem Ausfüllen hast du dir spontan {exp} gegeben.","vergleichPasst":"Das passt gut zu deinen Einzelangaben.","vergleichHoeher":"Deine Einzelangaben ergeben eine {res}, also {n} schlechter. Überlege, woran du deine spontane Einschätzung festgemacht hast, und sprich gegebenenfalls mit deinem Fachlehrer darüber.","vergleichNiedriger":"Deine Einzelangaben ergeben eine {res}, also {n} besser. Möglicherweise schätzt du dich spontan zu streng ein.","ansatzpunkte":"Hier schätzt du dich selbst niedrig ein:","druckAbweichung":"Abw. = Unterschied zwischen spontaner Erwartung und Ergebnis in Teilnotenstufen (+ = spontan besser eingeschätzt).","druckRechnerisch":"„rechn.“ = rechnerische Note vor der Begrenzung durch die Beteiligungshäufigkeit.","dateiname":"selbsteinschaetzung-fremdsprachen-raster-klasse-5-10","gleicheAntwort":"Du hast bei allen Aussagen dieselbe Antwort gewählt ({antwort}). Dann sagt die Auswertung wenig darüber aus, wo deine Stärken und Schwächen liegen. Überlege bei jeder Aussage noch einmal einzeln und bearbeite deinen Eintrag, wenn du etwas ändern möchtest.","kappungEntwicklung":"{bereich}: Mehr Regelmäßigkeit bringt dir hier am meisten.","kappungKurz":"Begrenzt durch die Beteiligungshäufigkeit"},"farbschema":"schwarz","massstab":"normal"}}];
  // Kopf und Fuß der Listenvorlage. 
  var LISTE_LEER = "\n\n<div class=\"sb-wrap sb-list\" data-sb-einstellbar>\n<div class=\"sb-topbar\"><a class=\"sb-back\" href=\"LINK-ZUM-KURS\">&#8592; Zurück zum Kurs</a></div>\n<h2 class=\"sb-title\" data-sb-text=\"titel\">Selbsteinschätzung mündliche Leistung</h2>\n<div class=\"sb-warn sb-setupwarn\" hidden></div>\n<div class=\"sb-setup\" hidden></div>\n<div class=\"sb-info sb-studentinfo\" data-sb-html=\"infoListe\"><p class=\"sb-noscript\">Der Bogen wird geladen …</p></div>\n<div class=\"sb-teacherbar\" hidden>\n<div class=\"sb-tinfo\"><strong>Lehreransicht:</strong> Hier stehen alle Einträge. Schüler sehen in dieser Liste nur ihre eigenen Einträge. Einträge daher nicht freigeben.</div>\n<div class=\"sb-tools\">\n<button type=\"button\" class=\"sb-btn\" data-sb-action=\"print\">&#128424; Liste drucken / als PDF</button>\n<button type=\"button\" class=\"sb-btn sb-btn-alt\" data-sb-action=\"csv\">&#8681; CSV-Datei (Excel)</button>\n<label class=\"sb-check\"><input type=\"checkbox\" class=\"sb-withtext\"> Reflexionstexte mitdrucken</label>\n</div>\n<p class=\"sb-pagehint\" hidden>Gedruckt und exportiert werden nur die Einträge dieser Seite. Für alle Einträge in der Suche bei „Einträge pro Seite“ einen höheren Wert wählen.</p>\n<p class=\"sb-tmsg\" hidden></p>\n</div>\n<div class=\"sb-tablewrap\"><table class=\"sb-table sb-overview\"><thead><tr><th>Schüler</th><th>Fach</th><th data-sb-text=\"spalteHalbjahr\">Halbjahr</th><th>Datum</th><th class=\"sb-c\">Erwartung</th><th class=\"sb-c\">Ergebnis</th><th class=\"sb-c\" data-sb-title=\"abweichungTitel\">Abweichung</th><th></th></tr></thead><tbody>\n</tbody></table></div></div>\n";
  // Gestaltung in den Ausgangsfarben: CSS-Vorlage des Presets ist schwarz;
  // ein anderes Farbschema des Bogens legt das Skript als eigenes Stylesheet darüber.
  var BASIS_CSS = "/* Selbsteinschätzung mündliche Leistung – alle Regeln auf .sb-wrap begrenzt */\n.sb-wrap {\n  --sb-ink: #10333a;\n  --sb-muted: #4b6b72;\n  --sb-teal: #0e7490;\n  --sb-teal-dark: #0b4f61;\n  --sb-teal-soft: #e6f6f9;\n  --sb-line: #cfe6ec;\n  --sb-card: #ffffff;\n  --sb-bg: #f3fafb;\n  --sb-good: #15803d;\n  --sb-mid: #b45309;\n  --sb-low: #b91c1c;\n  font-family: \"Segoe UI\", system-ui, -apple-system, Roboto, Arial, sans-serif;\n  color: var(--sb-ink);\n  background: var(--sb-bg);\n  border-radius: 14px;\n  padding: 18px;\n  max-width: 980px;\n  margin: 0 auto 1rem;\n  line-height: 1.5;\n  box-sizing: border-box;\n}\n.sb-wrap *, .sb-wrap *::before, .sb-wrap *::after { box-sizing: border-box; }\n.sb-wrap h2.sb-title { font-size: 1.45rem; font-weight: 700; color: var(--sb-teal-dark); margin: 0 0 .6rem; }\n.sb-wrap h3 { font-size: 1.08rem; font-weight: 700; color: var(--sb-teal-dark); margin: 0 0 .6rem; display: flex; align-items: center; gap: .5rem; }\n.sb-wrap p { margin: 0 0 .6rem; }\n.sb-wrap .sb-hidden { display: none !important; }\n\n/* Navigation */\n.sb-topbar { margin-bottom: 12px; }\n.sb-wrap a.sb-back {\n  display: inline-block; background: var(--sb-teal); color: #fff; text-decoration: none;\n  padding: 7px 16px; border-radius: 999px; font-weight: 600; font-size: .92rem;\n  box-shadow: 0 2px 6px rgba(14,116,144,.25);\n}\n.sb-wrap a.sb-back:hover, .sb-wrap a.sb-back:focus { background: var(--sb-teal-dark); color: #fff; }\n\n/* Karten */\n.sb-card {\n  background: var(--sb-card); border-radius: 12px; padding: 16px 18px; margin-bottom: 14px;\n  box-shadow: 0 2px 10px rgba(16,51,58,.08); border: 1px solid var(--sb-line);\n}\n.sb-info {\n  background: var(--sb-teal-soft); border-left: 5px solid var(--sb-teal); border-radius: 10px;\n  padding: 12px 16px; margin-bottom: 14px;\n}\n.sb-info p:last-child { margin-bottom: 0; }\n.sb-num {\n  display: inline-flex; align-items: center; justify-content: center; width: 1.7rem; height: 1.7rem;\n  border-radius: 50%; background: var(--sb-teal); color: #fff; font-size: .9rem; flex: none;\n}\n.sb-sub { color: var(--sb-muted); font-size: .93rem; }\n.sb-opt { font-size: .75rem; font-weight: 600; color: var(--sb-muted); background: var(--sb-teal-soft); border-radius: 999px; padding: 1px 9px; }\n.sb-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }\n.sb-grid2 > .sb-card { margin-bottom: 14px; }\n.sb-field { margin-bottom: 12px; }\n.sb-label { font-weight: 600; margin-bottom: 4px; }\n.sb-hint { display: block; color: var(--sb-muted); font-size: .86rem; font-style: italic; }\n.sb-code {\n  display: inline-block; min-width: 2.1rem; text-align: center; font-size: .75rem; font-weight: 700;\n  color: var(--sb-teal-dark); background: var(--sb-teal-soft); border-radius: 6px; padding: 1px 6px; margin-right: 6px;\n}\n\n/* Items im Formular */\n.sb-item { padding: 10px 0 12px; border-top: 1px dashed var(--sb-line); }\n.sb-item:first-of-type { border-top: 0; }\n.sb-qtext { display: flex; align-items: flex-start; gap: 4px; font-weight: 500; }\n.sb-qtext .sb-code { margin-top: 3px; }\n.sb-scale fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }\n.sb-scale legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }\n.sb-scale br { display: none; }\n.sb-scale input[type=\"radio\"] { position: absolute; opacity: 0; width: 1px; height: 1px; }\n.sb-scale input[type=\"radio\"] + label {\n  display: inline-block; margin: 4px 6px 4px 0; padding: 6px 13px; border-radius: 999px;\n  border: 1.5px solid var(--sb-line); background: #fff; cursor: pointer; font-size: .92rem;\n  transition: background .15s, border-color .15s;\n}\n.sb-scale input[type=\"radio\"] + label:hover { border-color: var(--sb-teal); }\n.sb-scale input[type=\"radio\"]:checked + label { background: var(--sb-teal); border-color: var(--sb-teal); color: #fff; font-weight: 600; }\n.sb-scale input[type=\"radio\"]:focus-visible + label { outline: 3px solid #67c6d9; outline-offset: 2px; }\n.sb-scale.sb-freq input[type=\"radio\"] + label { display: block; width: fit-content; }\n.sb-wrap select { border-radius: 8px; border: 1.5px solid var(--sb-line); padding: 5px 10px; }\n.sb-expect select { min-width: 6rem; }\n.sb-wrap textarea { width: 100%; border-radius: 8px; border: 1.5px solid var(--sb-line); }\n\n/* Einzelansicht */\n.sb-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }\n.sb-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--sb-muted); font-size: .92rem; align-items: center; }\n.sb-meta img { border-radius: 50%; }\n.sb-actions { white-space: nowrap; }\n.sb-warn, .sb-alert {\n  background: #fdecec; color: var(--sb-low); border: 1px solid #f5c2c2; border-radius: 10px;\n  padding: 10px 14px; margin-bottom: 14px; font-weight: 600;\n}\n.sb-warn[hidden] { display: none; }\n.sb-hero {\n  display: flex; align-items: center; gap: 18px; color: #fff; border-radius: 14px; padding: 18px 20px; margin-bottom: 14px;\n  background: linear-gradient(135deg, var(--sb-teal-dark), var(--sb-teal));\n  box-shadow: 0 4px 14px rgba(11,79,97,.25);\n}\n.sb-badge {\n  flex: none; width: 96px; height: 96px; border-radius: 50%; background: rgba(255,255,255,.16);\n  border: 3px solid rgba(255,255,255,.7); display: flex; flex-direction: column; align-items: center; justify-content: center;\n}\n.sb-pts { font-size: 2.3rem; font-weight: 800; line-height: 1; }\n.sb-ptslbl { font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; }\n.sb-kicker { font-size: .9rem; opacity: .9; }\n.sb-note { font-size: 1.5rem; font-weight: 700; }\n.sb-nvo { font-size: .92rem; opacity: .92; }\n.sb-capnote { background: #fff7e6; border-left: 4px solid var(--sb-mid); border-radius: 8px; padding: 10px 14px; margin: 8px 0; }\n.sb-compare { background: var(--sb-teal-soft); border-radius: 8px; padding: 10px 14px; margin-top: 8px; }\n.sb-compare.sb-off { background: #fff7e6; }\n.sb-bar { display: grid; grid-template-columns: 210px 1fr 48px; align-items: center; gap: 10px; margin: 7px 0; font-size: .93rem; }\n.sb-track { height: 12px; background: #e6eef0; border-radius: 999px; overflow: hidden; }\n.sb-fill { display: block; height: 100%; border-radius: 999px; }\n.sb-fill.sb-hi { background: var(--sb-teal); }\n.sb-fill.sb-mid { background: #e0a43b; }\n.sb-fill.sb-lo { background: #dc6b6b; }\n.sb-barpct { text-align: right; font-variant-numeric: tabular-nums; color: var(--sb-muted); }\n.sb-strength { border-top: 4px solid var(--sb-good); }\n.sb-develop { border-top: 4px solid var(--sb-mid); }\n.sb-tips, .sb-lowlist { margin: 0; padding-left: 1.2rem; }\n.sb-tips li, .sb-lowlist li { margin-bottom: 5px; }\n.sb-lowlist { list-style: none; padding-left: 0; }\n.sb-disclaimer { font-size: .86rem; color: var(--sb-muted); font-style: italic; }\n.sb-answers summary { cursor: pointer; font-weight: 700; color: var(--sb-teal-dark); }\n.sb-answers[open] summary { margin-bottom: 10px; }\n.sb-text { background: var(--sb-bg); border-radius: 8px; padding: 8px 12px; min-height: 2.2rem; }\n\n/* Tabellen */\n.sb-table { width: 100%; border-collapse: collapse; font-size: .93rem; }\n.sb-table th, .sb-table td { padding: 7px 9px; border-bottom: 1px solid var(--sb-line); text-align: left; vertical-align: top; }\n.sb-table .sb-dimrow th { background: var(--sb-teal-soft); color: var(--sb-teal-dark); }\n.sb-table td.sb-ans { font-weight: 600; white-space: nowrap; }\n.sb-tablewrap { overflow-x: auto; background: var(--sb-card); border-radius: 12px; border: 1px solid var(--sb-line); box-shadow: 0 2px 10px rgba(16,51,58,.08); }\n.sb-overview thead th { background: var(--sb-teal); color: #fff; font-weight: 600; white-space: nowrap; }\n.sb-overview tbody tr:hover { background: var(--sb-bg); }\n.sb-overview tr.sb-public { background: #fdecec; }\n.sb-wrap .sb-c { text-align: center; }\n.sb-date { white-space: nowrap; }\n.sb-rowactions { white-space: nowrap; }\n.sb-pill { display: inline-block; border-radius: 999px; padding: 2px 10px; font-weight: 700; color: #fff; white-space: nowrap; }\n.sb-pill.sb-g1, .sb-pill.sb-g2 { background: var(--sb-good); }\n.sb-pill.sb-g3 { background: var(--sb-teal); }\n.sb-pill.sb-g4 { background: var(--sb-mid); }\n.sb-pill.sb-g5, .sb-pill.sb-g6 { background: var(--sb-low); }\n.sb-diff.sb-off { color: var(--sb-mid); font-weight: 700; }\n\n/* Lehreransicht: Druck und Export */\n.sb-wrap [hidden] { display: none !important; }\n.sb-teacherbar {\n  background: var(--sb-card); border: 1px solid var(--sb-line); border-left: 5px solid var(--sb-teal-dark);\n  border-radius: 10px; padding: 12px 16px; margin-bottom: 14px; box-shadow: 0 2px 10px rgba(16,51,58,.08);\n}\n.sb-tinfo { margin-bottom: 10px; }\n.sb-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }\n.sb-wrap .sb-btn {\n  font: inherit; font-size: .92rem; font-weight: 600; cursor: pointer; border: 0; border-radius: 999px;\n  padding: 7px 16px; background: var(--sb-teal); color: #fff; box-shadow: 0 2px 6px rgba(14,116,144,.25);\n}\n.sb-wrap .sb-btn:hover, .sb-wrap .sb-btn:focus { background: var(--sb-teal-dark); }\n.sb-wrap .sb-btn:focus-visible { outline: 3px solid #67c6d9; outline-offset: 2px; }\n.sb-wrap .sb-btn-alt { background: #fff; color: var(--sb-teal-dark); border: 1.5px solid var(--sb-teal); box-shadow: none; }\n.sb-wrap .sb-btn-alt:hover, .sb-wrap .sb-btn-alt:focus { background: var(--sb-teal-soft); }\n.sb-check { display: inline-flex; align-items: center; gap: 6px; font-size: .92rem; color: var(--sb-muted); cursor: pointer; margin: 0; }\n.sb-pagehint, .sb-tmsg { margin: 10px 0 0; font-size: .88rem; color: var(--sb-mid); }\n.sb-rowactions .disapprove { margin-left: 4px; }\n\n@media (max-width: 640px) {\n  .sb-wrap { padding: 12px; }\n  .sb-grid2 { grid-template-columns: 1fr; }\n  .sb-bar { grid-template-columns: 1fr 44px; }\n  .sb-barlbl { grid-column: 1 / -1; }\n  .sb-hero { flex-direction: column; text-align: center; }\n  .sb-head { flex-direction: column; }\n}\n@media print {\n  .sb-topbar, .sb-actions, .sb-rowactions, .sb-comments, .sb-teacherbar { display: none; }\n  .sb-wrap { background: #fff; }\n}\n\n/* Formular für ein Projekt (formular.js). Im Editor und in der Variante „Einstellungen in Moodle“.\n * Alle Regeln gelten nur innerhalb von .ed-form, damit sie das Moodle-Design nicht stören. */\n.ed-form {\n  --ed-panel: #ffffff; --ed-text: #12313a; --ed-muted: #557079; --ed-line: #d5e2e6; --ed-accent: #0e7490; --ed-accent-dark: #0b5568;\n  --ed-soft: #e6f4f7; --ed-err: #b42318; --ed-err-bg: #fdecea; --ed-warn: #9a5b00; --ed-warn-bg: #fff6e0; --ed-ok: #146c43; --ed-ok-bg: #e7f6ee;\n  color: var(--ed-text);\n}\n.ed-form, .ed-form * { box-sizing: border-box; }\n.ed-form button, .ed-form input, .ed-form select, .ed-form textarea { font: inherit; color: inherit; }\n.ed-form .ed-mini { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--ed-line); background: var(--ed-panel); cursor: pointer; font-size: .85rem; }\n.ed-form .ed-mini:hover { border-color: var(--ed-accent); color: var(--ed-accent); }\n.ed-form .ed-mini.ed-danger:hover { border-color: var(--ed-err); color: var(--ed-err); }\n.ed-form .ed-sec { background: var(--ed-panel); border: 1px solid var(--ed-line); border-radius: 12px; margin-bottom: 12px; }\n.ed-form .ed-sec > summary { cursor: pointer; padding: 12px 16px; font-weight: 700; list-style: none; display: flex; justify-content: space-between; gap: 8px; }\n.ed-form .ed-sec > summary::-webkit-details-marker { display: none; }\n.ed-form .ed-sec > summary::after { content: \"▾\"; color: var(--ed-muted); }\n.ed-form .ed-sec:not([open]) > summary::after { content: \"▸\"; }\n.ed-form .ed-sec > summary .ed-badge { font-weight: 500; color: var(--ed-muted); font-size: .85rem; margin-left: auto; }\n.ed-form .ed-body { padding: 0 16px 14px; }\n.ed-form .ed-note { margin: 0 0 10px; color: var(--ed-muted); font-size: .88rem; }\n.ed-form .ed-note.ed-w { color: var(--ed-warn); background: var(--ed-warn-bg); padding: 8px 10px; border-radius: 8px; }\n.ed-form .f { display: block; margin: 0 0 10px; }\n.ed-form .f > span { display: block; font-weight: 600; font-size: .88rem; margin-bottom: 3px; }\n.ed-form .f > small { display: block; color: var(--ed-muted); font-size: .8rem; margin-top: 2px; }\n.ed-form .f input[type=\"text\"], .ed-form .f input[type=\"number\"], .ed-form .f textarea, .ed-form .f select { width: 100%; padding: 6px 9px; border: 1px solid var(--ed-line); border-radius: 7px; background: #fff; }\n.ed-form .f textarea { resize: vertical; min-height: 2.4em; }\n.ed-form .f input[type=\"number\"] { max-width: 7rem; }\n.ed-form .ed-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0 12px; }\n.ed-form .ed-check { display: flex; gap: 8px; align-items: center; margin: 0 0 10px; font-size: .92rem; }\n.ed-form .ed-radios { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-bottom: 10px; }\n.ed-form .ed-radios label { display: flex; gap: 6px; align-items: center; }\n.ed-form .ed-card { border: 1px solid var(--ed-line); border-radius: 10px; padding: 12px; margin-bottom: 12px; background: #fbfdfd; }\n.ed-form .ed-cardhead { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }\n.ed-form .ed-cardhead strong { margin-right: auto; }\n.ed-form .ed-key { display: inline-block; min-width: 1.8em; text-align: center; padding: 1px 6px; border-radius: 6px; background: var(--ed-accent); color: #fff; font-weight: 700; font-size: .85rem; }\n.ed-form .ed-item { border-left: 3px solid var(--ed-line); padding: 8px 0 4px 10px; margin: 8px 0; }\n.ed-form .ed-item:hover { border-left-color: var(--ed-accent); }\n.ed-form .ed-itemhead { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }\n.ed-form .ed-itemhead input { width: 5.5rem; padding: 3px 6px; border: 1px solid var(--ed-line); border-radius: 6px; font-weight: 700; }\n.ed-form .ed-itemhead .ed-spacer { flex: 1; }\n.ed-form .ed-grenzen { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; font-size: .88rem; margin: 6px 0 4px; }\n.ed-form .ed-grenzen select { padding: 3px 6px; border: 1px solid var(--ed-line); border-radius: 6px; }\n.ed-form .ed-sum { font-weight: 700; }\n.ed-form .ed-sum.ed-bad { color: var(--ed-warn); }\n.ed-form .ed-list { margin: 6px 0 0; padding-left: 1.2rem; font-size: .9rem; }\n.ed-form .ed-list li { margin: 2px 0; }\n.ed-form .ed-list.ed-e li { color: var(--ed-err); }\n.ed-form .ed-list.ed-w li { color: var(--ed-warn); }\n.ed-form .ed-addrow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }\n.ed-form .ed-addrow select { min-width: 0; max-width: 100%; flex: 1 1 14rem; padding: 4px 6px; border: 1px solid var(--ed-line); border-radius: 6px; }\n.ed-form details.ed-klapp > summary { cursor: pointer; list-style: none; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }\n.ed-form details.ed-klapp > summary::-webkit-details-marker { display: none; }\n.ed-form details.ed-klapp > summary::before { content: \"▾\"; color: var(--ed-muted); width: 1em; }\n.ed-form details.ed-klapp:not([open]) > summary::before { content: \"▸\"; }\n.ed-form details.ed-klapp > summary small { color: var(--ed-muted); font-size: .82rem; }\n.ed-form details.ed-klapp > summary strong { margin-right: 2px; }\n.ed-form details.ed-card[open] > summary { margin-bottom: 8px; }\n.ed-form details.ed-item > summary { font-size: .92rem; }\n.ed-form details.ed-item[open] > summary { margin-bottom: 6px; }\n.ed-form .ed-code { font-weight: 700; color: var(--ed-accent); min-width: 2.4em; }\n.ed-form .ed-sumtext { flex: 1 1 12rem; min-width: 0; }\n.ed-form .ed-klappleiste { display: flex; gap: 6px; justify-content: flex-end; margin: 0 0 8px; }\n.ed-form .ed-cardhead .ed-spacer { flex: 1; }\n.ed-form .ed-aus { opacity: .8; border-style: dashed; }\n.ed-form .ed-farbmuster { display: block; height: 2.1em; border-radius: 7px; border: 1px solid var(--ed-line); }\n.ed-form .f input[type=\"color\"] { width: 100%; height: 2.3em; padding: 2px; border: 1px solid var(--ed-line); border-radius: 7px; background: #fff; }\n\n/* Variante „Einstellungen in Moodle“: Bereich der Lehrkraft und Eingabeformular */\n.sb-wrap [hidden] { display: none !important; }\n.sb-setup { background: var(--sb-card); border: 1.5px solid var(--sb-teal); border-radius: 12px; padding: 12px 14px; margin: 0 0 1rem; }\n.sb-setuphead { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: space-between; }\n.sb-setupstate { color: var(--sb-muted); font-size: .92rem; }\n.sb-setupbody { margin-top: 12px; }\n.sb-setuptools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 6px; }\n.sb-setupsel { display: inline-flex; gap: 6px; align-items: center; font-weight: 600; margin: 0; }\n.sb-setupfoot { display: flex; flex-wrap: wrap; gap: 8px; position: sticky; bottom: 0; padding: 10px 0 2px; background: var(--sb-card); border-top: 1px solid var(--sb-line); }\n.sb-wrap .sb-setup label.sb-btn { margin: 0; cursor: pointer; }\n.sb-wrap .sb-ok { margin: 6px 0; padding: 8px 12px; border-radius: 8px; background: #e7f6ee; color: #146c43; }\n.sb-wrap .sb-setupmsg .sb-alert { margin: 6px 0; }\n.sb-wrap .ed-form { margin: 8px 0; }\n.sb-wrap .ed-form .ed-sec > summary { margin: 0; }\n.sb-wrap .ed-form h3, .sb-wrap .ed-form p { margin-top: 0; }\n.sb-wrap .sb-missing { outline: 2px solid var(--sb-low); outline-offset: 4px; border-radius: 8px; }\n.sb-wrap .sb-addmsg { margin: 0 0 1rem; }\n.sb-wrap .sb-native .form-control, .sb-wrap .sb-native input { width: 100%; }\n.sb-wrap .sb-fest { display: inline-block; padding: 5px 14px; border-radius: 999px; background: var(--sb-teal-soft); color: var(--sb-teal-dark); font-weight: 600; }\n";
  var TYP_EINSTELLUNG = 'Einstellung', TYP_EINTRAG = 'Einschaetzung';
  var ROOT = '', QS = '';

  /* ---------- Hilfen ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function txt(n) { return n ? String(n.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : ''; }
  function norm(s) { return String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function abs(u) { try { return new URL(u, location.href).href; } catch (e) { return u; } }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined && text !== null) { e.textContent = text; }
    return e;
  }
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) { bin += String.fromCharCode(bytes[i]); }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64decode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) { s += '='; }
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
    return new TextDecoder().decode(bytes);
  }
  // Kodiert, damit Moodle-Filter den Inhalt beim Anzeigen nicht verändern
  function kodiere(prefix, obj) { return prefix + b64encode(JSON.stringify(obj)); }
  function dekodiere(prefix, s) {
    s = String(s || '').replace(/\s+/g, '');
    if (s.indexOf(prefix) !== 0) { return null; }
    try { return JSON.parse(b64decode(s.slice(prefix.length))); } catch (e) { return null; }
  }
  function projektAus(s) {
    var p = dekodiere('cfg:', s);
    if (!p || p.format !== SE.FORMAT || !Array.isArray(p.bereiche) || !Array.isArray(p.skalen)) { return null; }
    return SEFormular.normalisieren(p, VORLAGEN[0].projekt);
  }
  function antwortenAus(s) { var a = dekodiere('ant:', s); return a && typeof a === 'object' ? a : {}; }
  function alleItems(p) {
    var l = [];
    p.bereiche.forEach(function (b) { b.items.forEach(function (it) { l.push({ b: b, it: it }); }); });
    return l;
  }
  function slug(s) {
    return String(s || 'selbsteinschaetzung').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'selbsteinschaetzung';
  }
  function herunterladen(name, daten, typ) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([daten], { type: typ }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- Moodle: Adressen, Lesen, Schreiben ---------- */
  function setupIds() {
    ROOT = (window.M && M.cfg && M.cfg.wwwroot) || location.href.split('/mod/data/')[0];
    var sp = new URLSearchParams(location.search);
    var id = sp.get('id'), d = sp.get('d');
    if (!id && !d) {
      var inp = document.querySelector('form input[name="d"]');
      if (inp && inp.value) { d = inp.value; }
    }
    if (!id && !d && window.M && M.cfg && M.cfg.contextInstanceId) { id = String(M.cfg.contextInstanceId); }
    if (!id && !d) {
      var a = document.querySelector('a[href*="/mod/data/view.php?d="], a[href*="/mod/data/view.php?id="], a[href*="/mod/data/edit.php?d="]');
      var m = a && a.getAttribute('href').match(/[?&](d|id)=(\d+)/);
      if (m) { if (m[1] === 'd') { d = m[2]; } else { id = m[2]; } }
    }
    QS = d ? 'd=' + d : (id ? 'id=' + id : '');
  }
  function get(url) {
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      if (!r.ok) { throw new Error('Der Server meldet einen Fehler (' + r.status + ').'); }
      return r;
    });
  }
  // Einträge aus Listenansicht 
  function zeilen(root) {
    return $$('.sb-row', root).map(function (row) {
      function raw(k) { return txt(row.querySelector('[data-sb-raw="' + k + '"]')); }
      function link(re) {
        var a = $$('a[href]', row).filter(function (x) { return re.test(x.getAttribute('href')); })[0];
        return a ? abs(a.getAttribute('href')) : '';
      }
      var status = row.getAttribute('data-sb-status') || '';
      return {
        el: row, id: (row.getAttribute('data-sb-id') || '').trim(), typ: raw('typ'),
        antworten: raw('antworten'), einstellung: raw('einstellung'),
        status: status, pending: status === 'notapproved',
        editUrl: link(/\/mod\/data\/edit\.php/), approveUrl: link(/[?&](amp;)?approve=/), disapproveUrl: link(/[?&](amp;)?disapprove=/)
      };
    });
  }
  function laden() {
    var url = ROOT + '/mod/data/view.php?' + QS + '&mode=list&perpage=1000&page=0&_=' + Date.now();
    return get(url).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      return { rows: zeilen(doc), lehrerNav: lehrerSeite(doc) };
    });
  }
  // Der neueste freigegebene Einstellungseintrag zählt. 
  function einstellungAus(rows) {
    var r = rows.filter(function (x) { return x.typ === TYP_EINSTELLUNG && !x.pending; })
      .sort(function (a, b) { return Number(b.id) - Number(a.id); });
    for (var i = 0; i < r.length; i++) {
      var p = projektAus(r[i].einstellung);
      if (p) { return { row: r[i], projekt: p }; }
    }
    return null;
  }
  function lehrerSeite(doc) {
    return !!(doc || document).querySelector('a[href*="/mod/data/field.php"], a[href*="/mod/data/templates.php"], a[href*="/mod/data/preset.php"], ' +
      'a[href*="/mod/data/import.php"], a[href*="/course/modedit.php"]');
  }
  // Nur Lehrkräfte sehen Freigabe-Links und dürfen den Einstellungseintrag bearbeiten.
  function istLehrer(rows, doc) {
    return lehrerSeite(doc) || rows.some(function (r) {
      return r.approveUrl || r.disapproveUrl || (r.typ === TYP_EINSTELLUNG && r.editUrl);
    });
  }

  /* Speichert Eintrag über das normale Moodle-Formular, im Hintergrund.
     werte: { Feldname: Wert }, rid: vorhandener Eintrag oder leer. Ergebnis: Nummer des Eintrags. */
  function speichern(werte, rid) {
    var url = ROOT + '/mod/data/edit.php?' + QS + (rid ? '&rid=' + rid : '') + '&_=' + Date.now();
    return get(url).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var form = null;
      $$('form', doc).forEach(function (f) {
        if (!form && f.querySelector('input[name="sesskey"]') && f.querySelector('#sb-add')) { form = f; }
      });
      if (!form) { throw new Error('Das Eingabeformular wurde nicht gefunden. Bist du noch in Moodle angemeldet?'); }
      var fd = new FormData();
      $$('input, textarea, select', form).forEach(function (e) {
        if (!e.name || e.disabled) { return; }
        var tp = (e.getAttribute('type') || '').toLowerCase();
        if (['submit', 'button', 'file', 'image', 'reset'].indexOf(tp) >= 0) { return; }
        if ((tp === 'checkbox' || tp === 'radio') && !e.checked) { return; }
        if (e.tagName === 'SELECT' && e.multiple) {
          $$('option', e).forEach(function (o) { if (o.selected) { fd.append(e.name, o.value); } });
          return;
        }
        fd.append(e.name, e.value);
      });
      Object.keys(werte).forEach(function (k) {
        var inp = $('[data-sb-field="' + k + '"] input[type="text"], [data-sb-field="' + k + '"] input:not([type])', form);
        if (!inp || !inp.name) { throw new Error('Das Feld „' + k + '“ fehlt in der Datenbank. Wurde das Preset vollständig importiert?'); }
        fd.set(inp.name, werte[k]);
      });
      fd.set('saveandview', 'Speichern');
      return fetch(ROOT + '/mod/data/edit.php', { method: 'POST', body: fd, credentials: 'same-origin' });
    }).then(function (res) {
      if (res.ok && /\/mod\/data\/view\.php/.test(res.url)) {
        var m = res.url.match(/[?&]rid=(\d+)/);
        return m ? m[1] : (rid || '');
      }
      return res.text().then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var weiter = doc.querySelector('meta[http-equiv="refresh"][content*="view.php"], .continuebutton a[href*="/mod/data/view.php"]');
        if (weiter && res.ok) {
          var m2 = (weiter.getAttribute('content') || weiter.getAttribute('href') || '').match(/[?&](?:amp;)?rid=(\d+)/);
          return m2 ? m2[1] : (rid || '');
        }
        var f = doc.querySelector('.alert-danger, .notifyproblem, .error, .invalid-feedback');
        throw new Error(f && txt(f) ? txt(f) : 'Speichern hat nicht geklappt. Bitte versuche es noch einmal.');
      });
    });
  }

  /* ---------- Texte des Bogens in die Vorlagen ---------- */
  function texteAnwenden(root, p, art) {
    $$('[data-sb-text]', root).forEach(function (n) { var t = p.texte[n.getAttribute('data-sb-text')]; if (t) { n.textContent = t; } });
    // HTML aus den Einstellungen der Lehrkraft, wie in den Vorlagen des festen Presets
    $$('[data-sb-html]', root).forEach(function (n) { var t = p.texte[n.getAttribute('data-sb-html')]; n.innerHTML = t || ''; });
    $$('[data-sb-title]', root).forEach(function (n) { var t = p.texte[n.getAttribute('data-sb-title')]; if (t) { n.title = t; } });
    $$('[data-sb-label]', root).forEach(function (n) {
      var f = p.felder[n.getAttribute('data-sb-label')];
      if (f) { n.textContent = (art === 'kurz' ? f.kurz : f.label) || n.textContent; }
    });
  }
  // Antworten als Elemente, die kern.js liest: <span data-sb-item="A1">Stufe</span>
  function antwortElemente(ziel, antworten) {
    Object.keys(antworten).forEach(function (code) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(code)) { return; }
      var s = el('span', null, antworten[code]);
      s.setAttribute('data-sb-item', code);
      ziel.appendChild(s);
    });
  }
  // Entfernte Reflexionsfelder ausblenden. Ergebnis: Zahl der Felder, die bleiben.
  function reflexionZeigen(sec, p) {
    var n = 0;
    ['Beispiel', 'Vorsatz'].forEach(function (k) {
      var aus = !!(p.felder[k] && p.felder[k].aus), lbl = sec && $('[data-sb-label="' + k + '"]', sec);
      var feld = lbl && lbl.closest('.sb-field');
      if (feld) { feld.hidden = aus; }
      if (!aus) { n++; }
    });
    return n;
  }
  function farbenAnwenden(p) {
    var alt = document.getElementById('sb-farben');
    if (!p || p.farbschema !== 'blau' && p.farbschema !== 'eigen') { if (alt) { alt.remove(); } return; }
    if (!alt) { alt = document.createElement('style'); alt.id = 'sb-farben'; document.head.appendChild(alt); }
    alt.textContent = SE.faerben(BASIS_CSS, p);
  }
  // Konfiguration der Auswertung, Druckansicht im Farbschema des Bogens
  function kernCfg(p) {
    var c = SE.kernKonfig(p);
    c.faerben = function (t) { return SE.faerben(t, p); };
    return c;
  }
  function hinweis(ziel, text, art) {
    ziel.innerHTML = '';
    ziel.appendChild(el('p', art || 'sb-alert', text));
    ziel.hidden = false;
  }

  /* ---------- Listenansicht ---------- */
  function initListe(wrap) {
    var rows = zeilen(document), cfg = einstellungAus(rows), lehrer = istLehrer(rows, document);
    // Einstellungseinträge gehören nicht in die Tabelle
    rows.forEach(function (r) { if (r.typ === TYP_EINSTELLUNG) { r.el.remove(); } });
    var eintraege = rows.filter(function (r) { return r.typ !== TYP_EINSTELLUNG; });
    if (lehrer) { einstellungen(wrap, cfg, eintraege); }
    var info = $('.sb-studentinfo', wrap);
    if (!cfg) {
      if (info) {
        hinweis(info, lehrer ? 'Der Bogen ist noch nicht eingerichtet. Wähle oben eine Vorlage, passe sie an und speichere die Einstellungen. Erst dann können Schüler den Bogen ausfüllen.'
          : 'Deine Lehrkraft hat den Bogen noch nicht eingerichtet. Schau später noch einmal vorbei.', 'sb-sub');
      }
      if (!eintraege.length) { var tw = $('.sb-tablewrap', wrap); if (tw) { tw.hidden = true; } }
      return;
    }
    texteAnwenden(wrap, cfg.projekt);
    farbenAnwenden(cfg.projekt);
    eintraege.forEach(function (r) {
      var ziel = $('.sb-hidden', r.el) || r.el;
      antwortElemente(ziel, antwortenAus(r.antworten));
    });
    sbKern(kernCfg(cfg.projekt));
  }

  /* ---------- Einstellungen der Lehrkraft ---------- */
  function verluste(alt, neu) {
    var l = [];
    if (!alt) { return l; }
    var neuItems = {};
    alleItems(neu).forEach(function (e) { neuItems[e.it.code.toLowerCase()] = e.it; });
    alleItems(alt).forEach(function (e) {
      var n = neuItems[e.it.code.toLowerCase()];
      if (!n) { l.push('Die Frage ' + e.it.code + ' fehlt. Ihre Antworten zählen nicht mehr.'); return; }
      var sa = SE.skalaFuer(alt, e.it), sn = SE.skalaFuer(neu, n);
      if (!sa || !sn) { return; }
      var da = sn.stufen.map(norm);
      var weg = sa.stufen.filter(function (st) { return da.indexOf(norm(st)) < 0; });
      if (weg.length) { l.push('Bei ' + e.it.code + ' fehlen die Stufen „' + weg.join('“, „') + '“. Einträge mit diesen Antworten gelten als unvollständig.'); }
    });
    if ((alt.massstab || 'normal') !== (neu.massstab || 'normal')) { l.push('Der Maßstab ist anders. Die Ergebnisse bisheriger Einträge ändern sich.'); }
    if (alt.modus !== neu.modus) { l.push('Die Notenskala ist anders. Die spontanen Erwartungen bisheriger Einträge lassen sich dann nicht mehr vergleichen.'); }
    return l;
  }

  // Fächer, die Lehrkraft selbst eingetragen hat.
  function eigeneFaecher(l) {
    var k = l.join('\n');
    return l.length > 0 && !VORLAGEN.some(function (v) { return v.projekt.felder.Fach.optionen.join('\n') === k; });
  }
  function einstellungen(wrap, cfg, eintraege) {
    var box = $('.sb-setup', wrap);
    if (!box) { return; }
    var gespeichert = cfg ? cfg.projekt : null, geaendert = false, F = null;
    box.hidden = false;
    box.innerHTML =
      '<div class="sb-setuphead"><div><strong>Bogen einstellen</strong> <span class="sb-setupstate"></span></div>' +
      '<button type="button" class="sb-btn" data-sb-setup="auf">&#9881; Einstellungen bearbeiten</button></div>' +
      '<div class="sb-setupbody" hidden>' +
      '<div class="sb-setuptools">' +
      '<label class="sb-setupsel">Neu aus Vorlage <select data-sb-setup="vorlage"><option value="">wählen …</option>' +
      VORLAGEN.map(function (v, i) { return '<option value="' + i + '">' + esc(v.name) + '</option>'; }).join('') + '</select></label>' +
      '<button type="button" class="sb-btn sb-btn-alt" data-sb-setup="export">&#8681; Exportieren</button>' +
      '<label class="sb-btn sb-btn-alt">&#8679; Importieren …<input type="file" accept=".json,.js" data-sb-setup="import" hidden></label>' +
      '</div>' +
      '<p class="sb-sub">Mit „Exportieren“ speicherst du den Bogen als Datei. Mit „Importieren“ übernimmst du ihn in eine andere Datenbank, zum Beispiel in einem anderen Kurs.</p>' +
      '<div class="sb-setupmsg" role="status"></div>' +
      '<div class="ed-form"></div>' +
      '<div class="sb-setupfoot"><button type="button" class="sb-btn" data-sb-setup="speichern">Einstellungen speichern</button>' +
      '<button type="button" class="sb-btn sb-btn-alt" data-sb-setup="zu">Schließen</button></div>' +
      '</div>';
    var state = $('.sb-setupstate', box), body = $('.sb-setupbody', box), msgBox = $('.sb-setupmsg', box), formEl = $('.ed-form', box);
    state.textContent = gespeichert ? '· eingerichtet: ' + gespeichert.name + ' · ' + eintraege.length + (eintraege.length === 1 ? ' Einschätzung' : ' Einschätzungen')
      : '· noch nicht eingerichtet';
    function meldung(html, fehler) {
      msgBox.innerHTML = html ? '<p class="' + (fehler ? 'sb-alert' : 'sb-ok') + '">' + html + '</p>' : '';
    }
    function oeffnen() {
      if (!F) {
        F = SEFormular.erstellen(formEl, {
          moodle: true, basis: VORLAGEN[0].projekt, status: meldung,
          beiAenderung: function (p) { geaendert = true; farbenAnwenden(p); }
        });
        F.laden(gespeichert || VORLAGEN[0].projekt);
        geaendert = !gespeichert;
      }
      body.hidden = false;
      $('[data-sb-setup="auf"]', box).hidden = true;
    }
    function laden(p, text) { F.laden(p); geaendert = true; meldung(text); }
    // Enter in einem Eingabefeld darf kein umgebendes Moodle-Formular absenden
    formEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); }
    });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sb-setup]');
      if (!b) { return; }
      var a = b.getAttribute('data-sb-setup');
      if (a === 'auf') { oeffnen(); }
      if (a === 'zu') {
        if (geaendert && gespeichert && !confirm('Ungespeicherte Änderungen verwerfen?')) { return; }
        if (geaendert && gespeichert) { F.laden(gespeichert); geaendert = false; meldung(''); }
        farbenAnwenden(gespeichert);
        body.hidden = true;
        $('[data-sb-setup="auf"]', box).hidden = false;
      }
      if (a === 'export') {
        var p = F.projekt();
        herunterladen(slug(p.name) + '.json', JSON.stringify(p, null, 2) + '\n', 'application/json');
        meldung('Exportiert. In einer anderen Datenbank lädst du die Datei mit „Importieren …“.');
      }
      if (a === 'speichern') { speichernKlick(b); }
    });
    box.addEventListener('change', function (e) {
      var a = e.target.getAttribute('data-sb-setup');
      if (a === 'vorlage') {
        var v = VORLAGEN[Number(e.target.value)];
        e.target.value = '';
        if (!v || !confirm('Die Einstellungen im Formular durch die Vorlage „' + v.name + '“ ersetzen? Gespeichert wird erst mit „Einstellungen speichern“.')) { return; }
        var neu = clone(v.projekt), faecher = F.projekt().felder.Fach.optionen.slice(), behalten = eigeneFaecher(faecher);
        if (behalten) { neu.felder.Fach.optionen = faecher; }
        laden(neu, 'Vorlage „' + esc(v.name) + '“ geladen' + (behalten ? ', dein Fach bleibt eingetragen (' + esc(faecher.join(', ')) + ')' : '') + '. Noch nicht gespeichert.');
      }
      if (a === 'import') {
        var datei = e.target.files[0];
        e.target.value = '';
        if (!datei) { return; }
        datei.text().then(function (t) {
          var p = /\.js$/i.test(datei.name) ? SE.projektAusSkript(t) : JSON.parse(t);
          if (!p || p.format !== SE.FORMAT) { throw new Error('Das ist keine exportierte Bogen-Datei.'); }
          if (!confirm('Die Einstellungen im Formular durch „' + datei.name + '“ ersetzen?')) { return; }
          laden(p, '„' + esc(datei.name) + '“ importiert. Noch nicht gespeichert.');
        }).catch(function (err) { meldung('Importieren nicht möglich: ' + esc(err.message), true); });
      }
    });
    function speichernKlick(knopf) {
      var r = F.pruefen(), p = F.projekt();
      if (r.fehler.length) {
        meldung('Noch nicht speicherbar: ' + r.fehler.length + ' Fehler oben im Formular beheben.', true);
        box.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      var weg = eintraege.length ? verluste(gespeichert, p) : [];
      if (weg.length && !confirm('Es gibt schon ' + eintraege.length + (eintraege.length === 1 ? ' Einschätzung' : ' Einschätzungen') +
        '. Diese Änderungen betreffen sie:\n\n• ' + weg.join('\n• ') + '\n\nTrotzdem speichern?')) { return; }
      knopf.disabled = true;
      meldung('Speichere …');
      speichern({ Typ: TYP_EINSTELLUNG, Einstellung: kodiere('cfg:', p) }, cfg ? cfg.row.id : '').then(function () {
        geaendert = false;
        meldung('Gespeichert. Die Seite wird neu geladen.');
        location.reload();
      }).catch(function (err) {
        knopf.disabled = false;
        meldung('Speichern nicht möglich: ' + esc(err.message), true);
      });
    }
    window.addEventListener('beforeunload', function (e) {
      if (geaendert && F && !body.hidden) { e.preventDefault(); e.returnValue = ''; }
    });
    if (!gespeichert) { oeffnen(); meldung('Noch nicht eingerichtet. Wähle eine Vorlage oder passe die Einstellungen unten an, dann „Einstellungen speichern“.'); }
  }

  /* ---------- Einzelansicht ---------- */
  function initEinzel(box) {
    var typ = txt($('[data-sb-raw="typ"]', box)), ergebnis = $('.sb-result', box);
    if (typ === TYP_EINSTELLUNG) {
      hinweis(ergebnis, 'Dies ist der Eintrag mit den Einstellungen des Bogens. Bearbeite ihn in der Listenansicht über „Einstellungen bearbeiten“, nicht hier. Nicht löschen: Ohne ihn können Schüler den Bogen nicht ausfüllen.', 'sb-sub');
      $$('.sb-answers, .sb-reflexion', box).forEach(function (n) { n.hidden = true; });
      return;
    }
    laden().then(function (res) {
      var cfg = einstellungAus(res.rows);
      if (!cfg) { hinweis(ergebnis, 'Die Einstellungen des Bogens fehlen. Ohne sie lässt sich der Eintrag nicht auswerten.'); return; }
      var p = cfg.projekt, ant = antwortenAus(txt($('[data-sb-raw="antworten"]', box)));
      texteAnwenden(box, p, 'kurz');
      var rk = $('.sb-reflexion', box);
      if (rk && !reflexionZeigen(rk, p)) { rk.hidden = true; }
      var tab = $('[data-sb-answers]', box);
      if (tab) {
        tab.innerHTML = '';
        p.bereiche.forEach(function (b) {
          var tr = el('tr', 'sb-dimrow'), th = el('th', null, b.name);
          th.colSpan = 3;
          tr.appendChild(th);
          tab.appendChild(tr);
          b.items.forEach(function (it) {
            var z = el('tr'), a = el('td', 'sb-ans'), s = el('span', null, ant[it.code] || '');
            s.setAttribute('data-sb-item', it.code);
            a.appendChild(s);
            z.appendChild(el('td', 'sb-code', it.code));
            z.appendChild(el('td', null, it.text));
            z.appendChild(a);
            tab.appendChild(z);
          });
        });
      }
      farbenAnwenden(p);
      sbKern(kernCfg(p));
    }).catch(function (err) { hinweis(ergebnis, 'Der Bogen konnte nicht geladen werden: ' + err.message); });
  }

  /* ---------- Eingabeformular ---------- */
  function initEingabe(wrap) {
    var form = wrap.closest('form'), bereit = false, P = null, ant = {};
    var meldungEl = $('.sb-addmsg', wrap), mount = $('.sb-flexform', wrap);
    function nativ(name) {
      return $('[data-sb-field="' + name + '"] input[type="text"], [data-sb-field="' + name + '"] input:not([type])', wrap);
    }
    function setze(name, v) { var n = nativ(name); if (n) { n.value = v; } }
    function wert(name) { var n = nativ(name); return n ? n.value : ''; }
    function fehler(text) { meldungEl.textContent = text; meldungEl.hidden = !text; }

    if (wert('Typ') === TYP_EINSTELLUNG) {
      $('[data-sb-native]', wrap).hidden = false;
      hinweis($('[data-sb-addwarn]', wrap), 'Das ist der Eintrag mit den Einstellungen des Bogens. Die Einstellungen änderst du am besten in der Listenansicht über „Einstellungen bearbeiten“.', 'sb-sub');
      return;
    }
    if (form) {
      form.addEventListener('submit', function (e) {
        var s = e.submitter;
        if (s && /cancel/i.test(s.name || '')) { return; }
        var fehlt = pruefen();
        if (fehlt) { e.preventDefault(); e.stopPropagation(); }
      }, true);
    }
    function lehrerWarnung(lehrer) {
      if (!lehrer) { return; }
      hinweis($('[data-sb-addwarn]', wrap), 'Du bist als Lehrkraft angemeldet. Moodle gibt deine Einträge sofort frei, sie sind dann für alle Kursteilnehmer sichtbar. ' +
        'Zum Ansehen des Formulars also nicht speichern, oder den Eintrag danach löschen. Den Bogen stellst du in der Listenansicht über „Einstellungen bearbeiten“ ein.');
    }
    lehrerWarnung(lehrerSeite(document));

    laden().then(function (res) {
      var cfg = einstellungAus(res.rows);
      lehrerWarnung(res.lehrerNav || istLehrer(res.rows, document));
      if (!cfg) {
        var ziel = $('[data-sb-html="infoEingabe"]', wrap) || mount;
        if (res.lehrerNav || istLehrer(res.rows, document)) {
          ziel.innerHTML = '<p class="sb-alert">Der Bogen ist noch nicht eingerichtet. Das machst du in der Ansicht der Datenbank unter „Bogen einstellen“. ' +
            'Danach erscheint hier das Formular.</p><p><a class="sb-btn" href="' + esc(ROOT + '/mod/data/view.php?' + QS) + '">&#9881; Bogen jetzt einrichten</a></p>';
          ziel.hidden = false;
          $('[data-sb-addwarn]', wrap).hidden = true;
        } else {
          hinweis(ziel, 'Deine Lehrkraft hat den Bogen noch nicht eingerichtet. Speichern ist deshalb noch nicht möglich.');
        }
        return;
      }
      P = cfg.projekt;
      farbenAnwenden(P);
      ant = antwortenAus(wert('Antworten'));
      texteAnwenden(wrap, P);
      bauen();
      var refl = $('[data-sb-reflexion]', wrap), aktiv = reflexionZeigen(refl, P);
      if (refl && aktiv) {
        refl.hidden = false;
        $('[data-sb-num]', refl).textContent = String(P.bereiche.length + 2);
        if (aktiv === 1) { $('.sb-sub', refl).textContent = 'Das Feld kannst du auch nach der Rückmeldung noch ergänzen: Eintrag öffnen und bearbeiten.'; }
      }
      bereit = true;
      uebertragen();
    }).catch(function (err) {
      hinweis(mount, 'Der Bogen konnte nicht geladen werden: ' + err.message + ' Lade die Seite neu.');
    });

    function radios(name, stufen, gewaehlt) {
      return '<fieldset><legend>' + esc(name) + '</legend>' + stufen.map(function (st, i) {
        var id = 'sb-' + name + '-' + i;
        return '<input type="radio" form="sb-ohne-formular" id="' + esc(id) + '" name="sb-' + esc(name) + '" value="' + esc(st) + '"' +
          (st === gewaehlt ? ' checked' : '') + '><label for="' + esc(id) + '">' + esc(st) + '</label><br>';
      }).join('') + '</fieldset>';
    }
    function auswahl(name, optionen, gewaehlt) {
      return '<select form="sb-ohne-formular" data-sb-in="' + esc(name) + '"><option value="">Auswählen …</option>' + optionen.map(function (o) {
        return '<option value="' + esc(o) + '"' + (o === gewaehlt ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('') + '</select>';
    }
    function bauen() {
      var F = P.felder, h = '';
      h += '<section class="sb-card" data-sb-rahmen><h3><span class="sb-num">1</span> Rahmendaten</h3>' +
        '<div class="sb-grid2"><div class="sb-field" data-sb-need="Fach"><div class="sb-label">' + esc(F.Fach.label) + '</div>' +
        (F.Fach.optionen.length === 1 ? '<div class="sb-fest" data-sb-fach-fest>' + esc(F.Fach.optionen[0]) + '</div>' :
          '<div class="sb-scale sb-inline" data-sb-in="Fach">' + radios('Fach', F.Fach.optionen, wert('Fach')) + '</div>') + '</div>' +
        '<div class="sb-field" data-sb-need="Halbjahr"><div class="sb-label">' + esc(F.Halbjahr.label) + '</div>' + auswahl('Halbjahr', F.Halbjahr.optionen, wert('Halbjahr')) + '</div></div>' +
        '<div class="sb-field sb-expect" data-sb-need="Erwartung"><div class="sb-label">' + esc(F.Erwartung.label) + '</div>' +
        auswahl('Erwartung', SE.erwartungOptionen(P.modus), wert('Erwartung')) + '<div class="sb-hint">' + esc(F.Erwartung.hinweis) + '</div></div></section>';
      P.bereiche.forEach(function (b, i) {
        h += '<section class="sb-card" data-sb-dim="' + esc(b.key) + '"><h3><span class="sb-num">' + (i + 2) + '</span> ' + esc(b.name) + '</h3>' +
          '<p class="sb-sub">' + esc(b.frage) + '</p>';
        b.items.forEach(function (it) {
          var s = SE.skalaFuer(P, it), art = s.darstellung === 'untereinander' ? 'sb-freq' : 'sb-inline';
          h += '<div class="sb-item" data-sb-q="' + esc(it.code) + '"><p class="sb-qtext"><span class="sb-code">' + esc(it.code) + '</span><span>' + esc(it.text) +
            (it.hinweis ? '<span class="sb-hint">' + esc(it.hinweis) + '</span>' : '') + '</span></p>' +
            '<div class="sb-scale ' + art + '" data-sb-in="' + esc(it.code) + '">' + radios(it.code, SE.anzeigeStufen(s), ant[it.code]) + '</div></div>';
        });
        h += '</section>';
      });
      mount.innerHTML = h;
      mount.addEventListener('change', function (e) {
        var t = e.target, box = t.closest('[data-sb-in]'), name = box && box.getAttribute('data-sb-in');
        if (!name) { return; }
        if (name === 'Fach' || name === 'Halbjahr' || name === 'Erwartung') { setze(name, t.value); }
        else { ant[name] = t.value; }
        var q = t.closest('.sb-missing');
        if (q) { q.classList.remove('sb-missing'); }
        uebertragen();
        // Steht schon ein Hinweis da, zeigt er nur noch, was wirklich fehlt
        if (!meldungEl.hidden) { pruefen(true); }
      });
    }
    function uebertragen() {
      setze('Typ', TYP_EINTRAG);
      if (P.felder.Fach.optionen.length === 1) { setze('Fach', P.felder.Fach.optionen[0]); }
      var a = {};
      alleItems(P).forEach(function (e) { if (ant[e.it.code]) { a[e.it.code] = ant[e.it.code]; } });
      setze('Antworten', Object.keys(a).length ? kodiere('ant:', a) : '');
    }
    // Ergebnis: true, wenn etwas fehlt (dann nicht speichern)
    function pruefen(still) {
      if (!bereit) { fehler('Der Bogen ist noch nicht geladen. Bitte einen Moment warten und erneut speichern.'); return true; }
      uebertragen();
      var fehlt = [];
      $$('.sb-missing', wrap).forEach(function (n) { n.classList.remove('sb-missing'); });
      ['Fach', 'Halbjahr', 'Erwartung'].forEach(function (k) {
        var ok = k === 'Fach' ? P.felder.Fach.optionen.indexOf(wert(k)) >= 0 : !!wert(k);
        if (!ok) { fehlt.push(P.felder[k].label.replace(/^Bevor du startest: /, '')); $('[data-sb-need="' + k + '"]', wrap).classList.add('sb-missing'); }
      });
      var codes = [];
      alleItems(P).forEach(function (e) {
        var s = SE.skalaFuer(P, e.it), v = ant[e.it.code];
        if (!v || s.stufen.map(norm).indexOf(norm(v)) < 0) {
          codes.push(e.it.code);
          var q = $('[data-sb-q="' + e.it.code + '"]', wrap);
          if (q) { q.classList.add('sb-missing'); }
        }
      });
      if (codes.length) { fehlt.push(codes.length === 1 ? 'Frage ' + codes[0] : 'Fragen ' + codes.join(', ')); }
      if (!fehlt.length) { fehler(''); return false; }
      fehler('Bitte noch ausfüllen: ' + fehlt.join(' · ') + '. Erst dann kann deine Einschätzung ausgewertet werden.');
      var erst = $('.sb-missing', wrap);
      if (!still && erst && erst.scrollIntoView) { erst.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      return true;
    }
  }

  /* ---------- Start ---------- */
  // Listenansicht ohne Einträge
  function leereListe() {
    if (!/\/mod\/data\/view\.php/.test(location.pathname) || $('.sb-wrap[data-sb-einstellbar]')) { return null; }
    var sp = new URLSearchParams(location.search), mode = sp.get('mode') || 'list';
    if (sp.get('rid') || mode !== 'list') { return null; }
    var main = $('[role="main"]') || $('#region-main') || document.body, box = document.createElement('div');
    box.innerHTML = LISTE_LEER;
    var liste = $('.sb-list', box);
    if (!liste) { return null; }
    main.insertBefore(liste, main.firstChild);
    return liste;
  }

  function init() {
    setupIds();
    leereListe();
    var liste = $('.sb-list[data-sb-einstellbar]'), einzel = $('.sb-entry[data-sb-einstellbar]'), eingabe = $('.sb-add[data-sb-einstellbar]');
    try {
      if (liste) { initListe(liste); }
      if (einzel) { initEinzel(einzel); }
      if (eingabe) { initEingabe(eingabe); }
    } catch (err) {
      var z = liste || einzel || eingabe;
      if (z) { z.insertBefore(el('p', 'sb-alert', 'Fehler im Skript: ' + err.message), z.firstChild); }
      throw err;
    }
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();

})();
