// Service Worker for PWA functionality

// ---------------------------------------------------------------------------
// App language: read from Cache API (written by app from localStorage), fallback to navigator
// ---------------------------------------------------------------------------
var SW_LOCALE_CACHE_NAME = "app-prefs";
var SW_LOCALE_CACHE_KEY = "/app-locale";

function getDeviceLangSync() {
  try {
    var lang = (self.navigator && self.navigator.language) ? self.navigator.language.split("-")[0] : "en";
    return lang === "ru" ? "ru" : "en";
  } catch (_) {
    return "en";
  }
}

function getAppLang() {
  try {
    if (!self.caches || !self.caches.open) return Promise.resolve(getDeviceLangSync());
    return self.caches.open(SW_LOCALE_CACHE_NAME).then(function (cache) {
      return cache.match(SW_LOCALE_CACHE_KEY);
    }).then(function (response) {
      if (response) return response.text();
      return null;
    }).then(function (lang) {
      if (lang === "ru" || lang === "en") return lang;
      return getDeviceLangSync();
    }).catch(function () {
      return getDeviceLangSync();
    });
  } catch (_) {
    return Promise.resolve(getDeviceLangSync());
  }
}

// ---------------------------------------------------------------------------
// Default assets
// ---------------------------------------------------------------------------
var DEFAULT_ICON = "/icons/icon-192x192.png";

// ---------------------------------------------------------------------------
// Notification type handlers
// Add a new type by adding an entry to NOTIFICATION_TYPE_HANDLERS.
// Each handler can define: icon, badge, image, getActions(lang), getTitle(n, lang), getBody(n, lang), getData(n), onActionClick(event, data, action).
// ---------------------------------------------------------------------------

var UNIT_LABELS = {
  en: {
    pill: "pills", capsule: "capsules", ml: "ml", drops: "drops", milligram: "mg", gram: "g", iu: "IU",
    ampoule: "ampoules", injection: "injections", inhalation: "inhalations", patch: "patches",
    application: "applications", spray: "sprays", portion: "portions", tablespoon: "tablespoons",
    teaspoon: "teaspoons", unit: "units", suppository: "suppositories", other: "other",
  },
  ru: {
    pill: "таблеток", capsule: "капсул", ml: "мл", drops: "капель", milligram: "мг", gram: "г", iu: "МЕ",
    ampoule: "ампул", injection: "инъекций", inhalation: "ингаляций", patch: "пластырей",
    application: "нанесений", spray: "впрыскиваний", portion: "порций", tablespoon: "ст. ложек",
    teaspoon: "ч. ложек", unit: "единиц", suppository: "свечей", other: "другое",
  },
};

function translateUnit(unitKey, lang) {
  if (!unitKey || typeof unitKey !== "string") return "pills";
  var key = unitKey.toLowerCase();
  var langMap = UNIT_LABELS[lang] || UNIT_LABELS.en;
  return langMap[key] || UNIT_LABELS.en[key] || key;
}

var MEDICATION_TITLES = { en: "Medications", ru: "Лекарства" };
var MEDICATION_ACTION_LABELS = { en: { confirm: "Confirm", skip: "Skip" }, ru: { confirm: "Подтвердить", skip: "Пропустить" } };

function getMedicationTitle(n, lang) {
  return MEDICATION_TITLES[lang] || MEDICATION_TITLES.en + " · " + (n.timeStr || "");
}

function getMedicationActionLabels(lang) {
  return MEDICATION_ACTION_LABELS[lang] || MEDICATION_ACTION_LABELS.en;
}

function getMedicationBody(n, lang) {
  if (n.medicationName == null || n.amount == null) return n.body;
  var unitLabel = translateUnit(n.unit, lang);
  return "• " + n.medicationName + " — " + n.amount + " " + unitLabel;
}

function getMedicationData(n) {
  var doseEventIds = Array.isArray(n.dose_event_ids)
    ? n.dose_event_ids
    : n.dose_event_id != null ? [n.dose_event_id] : [];
  return { dose_event_ids: doseEventIds };
}

/** Resolves a type handler for a given notification type. Multiple types can share one handler. */
function getTypeHandler(type) {
  if (type === "medication" || type === "medication_snoozed") {
    return NOTIFICATION_TYPE_HANDLERS.medication;
  }
  return NOTIFICATION_TYPE_HANDLERS[type] || null;
}

var NOTIFICATION_TYPE_HANDLERS = {
  medication: {
    icon: "/icons/icon-512x512.png",
    badge: "/icons/pills-128x128.png",
    image: "/icons/pills-128x128.png",
    getActions: function (lang) {
      var labels = getMedicationActionLabels(lang);
      return [
        { action: "confirm", title: labels.confirm },
        { action: "skip", title: labels.skip },
      ];
    },
    getTitle: function (n, lang) {
      return (n.medicationName != null && n.amount != null) ? getMedicationTitle(n, lang) : (n.title || "Notification");
    },
    getBody: function (n, lang) {
      return (n.medicationName != null && n.amount != null) ? getMedicationBody(n, lang) : n.body;
    },
    getData: function (n, baseData) {
      var extra = getMedicationData(n);
      return Object.assign({}, baseData, extra);
    },
    onActionClick: function (event, data, action) {
      var doseEventIds = data.dose_event_ids;
      if (!Array.isArray(doseEventIds) || doseEventIds.length === 0) return null;
      if (action !== "confirm" && action !== "skip") return null;
      var apiAction = action === "confirm" ? "taken" : "skipped";
      return fetch(self.location.origin + "/api/notifications/medication-action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dose_event_ids: doseEventIds, action: apiAction }),
      });
    },
  },
};

// ---------------------------------------------------------------------------
// Common: build options and show notification
// ---------------------------------------------------------------------------
function resolveUrl(n) {
  var url = n.url;
  if (!url) return "/";
  return url.startsWith("/") ? self.location.origin + url : url;
}

function buildNotificationOptions(n, lang) {
  var type = n.type || "";
  var handler = getTypeHandler(type);
  var baseData = {
    url: resolveUrl(n),
    type: type,
  };
  var title = n.title || "Notification";
  var body = n.body;
  var icon = DEFAULT_ICON;
  var badge = DEFAULT_ICON;
  var image;
  var actions;
  var data = baseData;

  if (handler) {
    if (handler.icon != null) icon = handler.icon;
    if (handler.badge != null) badge = handler.badge;
    if (handler.image != null) image = handler.image;
    if (typeof handler.getTitle === "function") title = handler.getTitle(n, lang);
    if (typeof handler.getBody === "function") body = handler.getBody(n, lang);
    if (typeof handler.getActions === "function") actions = handler.getActions(lang);
    if (typeof handler.getData === "function") data = handler.getData(n, baseData);
  }

  var options = {
    body: body,
    icon: icon,
    badge: badge,
    vibrate: [100, 50, 100],
    tag: n.id ? "notification-" + n.id : "notification-" + Date.now(),
    data: data,
  };
  if (image != null) options.image = image;
  if (actions != null && actions.length > 0) options.actions = actions;
  return { title: title, options: options };
}

// ---------------------------------------------------------------------------
// Common: handle action click (open URL or type-specific handler)
// ---------------------------------------------------------------------------
function openNotificationUrl(url, actionBaseUrl) {
  var base = actionBaseUrl || self.location.origin;
  var resolved = (url || "/").startsWith("http") ? url : base + (url.startsWith("/") ? url : "/" + url);
  return self.clients.matchAll({ type: "window" }).then(function (clientList) {
    for (var i = 0; i < clientList.length; i++) {
      var client = clientList[i];
      if (client.url.indexOf(self.registration.scope) !== -1 && "focus" in client) {
        client.navigate(resolved);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(resolved);
  });
}

function handleNotificationClick(event, data, action) {
  var type = data.type || "";
  var handler = getTypeHandler(type);

  if (handler && typeof handler.onActionClick === "function") {
    var result = handler.onActionClick(event, data, action);
    if (result && typeof result.then === "function") return result;
  }

  if (action === "dismiss") return null;
  if (action === "settings") {
    var url = data.url || "/";
    var settingsUrl = url.startsWith("http") ? new URL("/settings", url).href : (data.actionBaseUrl || self.location.origin) + "/settings";
    return openNotificationUrl(settingsUrl, data.actionBaseUrl);
  }

  return openNotificationUrl(data.url || "/", data.actionBaseUrl);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
self.addEventListener("install", function (event) {
  console.log("Service Worker installing.");
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  console.log("Service Worker activated.");
  event.waitUntil(self.clients.claim());
});

// ---------------------------------------------------------------------------
// Push: show notifications (batch or single)
// ---------------------------------------------------------------------------
self.addEventListener("push", function (event) {
  if (!event.data) return;
  var data = event.data.json();
  if (data.notifications && Array.isArray(data.notifications)) {
    var promise = getAppLang().then(function (lang) {
      if (!self.registration.showNotification) return;
      return Promise.all(
        data.notifications.map(function (n) {
          var built = buildNotificationOptions(n, lang);
          return self.registration
            .showNotification(built.title, built.options)
            .then(function () {
              var ids = n.ids && Array.isArray(n.ids) ? n.ids : (n.id ? [n.id] : null);
              if (ids && ids.length > 0) {
                return fetch(self.location.origin + "/api/notifications/mark-shown", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(ids.length === 1 ? { id: ids[0] } : { ids: ids }),
                });
              }
            });
        })
      );
    });
    event.waitUntil(promise);
    return;
  }
  if (data.title) {
    var options = {
      body: data.body,
      icon: data.icon || DEFAULT_ICON,
      badge: data.badge || DEFAULT_ICON,
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: data.primaryKey || "1",
        url: data.url || "/",
        type: data.type || "",
      },
    };
    event.waitUntil(self.registration.showNotification(data.title, options));
  }
});

// ---------------------------------------------------------------------------
// Notification click: dispatch to type handler or default (open URL)
// ---------------------------------------------------------------------------
self.addEventListener("notificationclick", function (event) {
  console.log("Notification click received.", event.action);
  event.notification.close();

  var data = event.notification.data || {};
  var action = event.action || "";

  var result = handleNotificationClick(event, data, action);
  if (result && typeof result.then === "function") {
    event.waitUntil(result);
  }
});

// ---------------------------------------------------------------------------
// Fetch (offline support)
// ---------------------------------------------------------------------------
self.addEventListener("fetch", function (event) {
  // Let the browser handle the request normally
});
