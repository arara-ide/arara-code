'use strict';

const catalogs = {
  en: require('./locales/en.json'),
  pt: require('./locales/pt.json'),
  es: require('./locales/es.json'),
};

let selected = 'en';

function language(value) {
  const base = String(value || '').toLowerCase().split(/[-_]/)[0];
  return base === 'pt' || base === 'es' ? base : 'en';
}

function setLanguage(value) {
  selected = language(value);
}

function t(message, ...values) {
  const catalog = catalogs[selected];
  const text = Object.hasOwn(catalog, message) ? catalog[message] : message;
  return text.replace(/\{(\d+)\}/g, (token, index) => Number(index) < values.length ? String(values[Number(index)]) : token);
}

module.exports = { catalogs, language, setLanguage, t };
