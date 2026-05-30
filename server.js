const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 8173;
const ROOT = __dirname;
const CACHE_TTL = 1000 * 60 * 60 * 24;
const vehicleCache = new Map();

loadEnvFile(".env.local");
loadEnvFile(".env");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf"
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/vehicle-by-plate") {
      await handleVehicleByPlate(request, response);
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      serveStatic(request, response);
      return;
    }

    sendJson(response, 405, { error: "method_not_allowed", message: "Méthode non autorisée." });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "server_error", message: "Erreur serveur." });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Entretien Auto prêt sur http://127.0.0.1:${PORT}`);
});

async function handleVehicleByPlate(request, response) {
  const body = await readJsonBody(request);
  const plate = normalizePlate(body.plate || "");

  if (!isValidFrenchPlate(plate)) {
    sendJson(response, 400, { error: "invalid_plate", message: "Plaque française invalide." });
    return;
  }

  try {
    const vehicle = await getVehicleByPlate(plate);

    if (!vehicle) {
      sendJson(response, 404, { error: "not_found", message: "Aucun véhicule trouvé pour cette plaque." });
      return;
    }

    sendJson(response, 200, vehicle);
  } catch (error) {
    if (error.code === "missing_key") {
      sendJson(response, 500, { error: "missing_api_key", message: "Clé RAPIDAPI_KEY manquante côté serveur." });
      return;
    }

    if (error.code === "bad_api_config") {
      sendJson(response, 500, { error: "bad_api_config", message: error.message });
      return;
    }

    if (error.code === "quota_exceeded") {
      sendJson(response, 429, { error: "quota_exceeded", message: "Quota API dépassé." });
      return;
    }

    if (error.code === "api_timeout") {
      sendJson(response, 504, { error: "api_timeout", message: "L'API RapidAPI ne répond pas." });
      return;
    }

    if (error.code === "api_error") {
      sendJson(response, error.status || 502, { error: "api_error", message: error.message || "Erreur API." });
      return;
    }

    throw error;
  }
}

async function getVehicleByPlate(plate) {
  const normalizedPlate = normalizePlate(plate);
  const cached = vehicleCache.get(normalizedPlate);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL) {
    return cached.data;
  }

  const apiKey = process.env.RAPIDAPI_KEY;
  const apiHost = process.env.RAPIDAPI_HOST;

  if (!apiKey || apiKey.includes("votre_cle_api_ici")) {
    const error = new Error("RAPIDAPI_KEY manquante.");
    error.code = "missing_key";
    throw error;
  }

  if (!apiHost) {
    const error = new Error("RAPIDAPI_HOST manquant.");
    error.code = "bad_api_config";
    throw error;
  }

  const endpoint = normalizeApiEndpoint(
    process.env.API_PLAQUE_URL || `https://${apiHost}/`
  );
  const plateParam = process.env.API_PLAQUE_PARAM || "plaque";
  const url = new URL(endpoint);
url.searchParams.set(plateParam, normalizedPlate);

console.log("URL =", url.toString());
console.log("PLATE =", normalizedPlate);
console.log("PARAM =", plateParam);
  

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  let apiResponse;

  try {
    apiResponse = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": apiHost
      },
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("Timeout API RapidAPI.");
      timeoutError.code = "api_timeout";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (apiResponse.status === 204 || apiResponse.status === 404) {
    vehicleCache.set(normalizedPlate, { createdAt: Date.now(), data: null });
    return null;
  }

  if (apiResponse.status === 401 || apiResponse.status === 403 || apiResponse.status === 429) {
    const error = new Error("Quota API dépassé ou accès refusé.");
    error.code = "quota_exceeded";
    error.status = apiResponse.status;
    throw error;
  }

if (!apiResponse.ok) {
  const body = await apiResponse.text();

  console.log("===== ERREUR RAPIDAPI =====");
  console.log("STATUS :", apiResponse.status);
  console.log("BODY :", body);
  console.log("===========================");

  const error = new Error(`Erreur API: ${apiResponse.status}`);
  error.code = "api_error";
  error.status = apiResponse.status;
  throw error;
}

const raw = await apiResponse.json();

console.log("RÉPONSE API =", JSON.stringify(raw, null, 2));
  const vehicle = mapVehicleResponse(raw);

  vehicleCache.set(normalizedPlate, { createdAt: Date.now(), data: vehicle });
  return vehicle;
}

function mapVehicleResponse(raw) {
  const source = getVehicleSource(raw);

  const vehicle = {
    brand:
      source.AWN_marque ||
      source.marque ||
      "",

    model:
      source.AWN_modele ||
      source.modele ||
      "",

    version:
      source.AWN_version ||
      source.finition ||
      "",

    fuel:
      source.AWN_energie ||
      "",

    fiscalPower:
      source.AWN_puissance_fiscale ||
      "",

    horsePower:
      source.AWN_puissance_chevaux
        ? `${source.AWN_puissance_chevaux} ch`
        : "",

    year:
      source.AWN_date_mise_en_circulation_us
        ? source.AWN_date_mise_en_circulation_us.substring(0, 4)
        : "",

    co2:
      source.AWN_emission_co_2
        ? `${source.AWN_emission_co_2} g/km`
        : "",

    engine:
      source.AWN_code_moteur || "",

    color:
      source.AWN_couleur === "INCONNU"
        ? ""
        : source.AWN_couleur
  };

  return vehicle;
}

function getVehicleSource(raw) {
  if (Array.isArray(raw)) return raw[0] || {};
  if (!raw || typeof raw !== "object") return {};

  const nested = raw.data || raw.result || raw.vehicle || raw.vehicule || raw.response;
  if (Array.isArray(nested)) return nested[0] || {};
  if (nested && typeof nested === "object") return nested;

  return raw;
}

function normalizeApiEndpoint(endpoint) {
  let value = String(endpoint || "").trim();

  if (!value) {
    const error = new Error("URL API manquante.");
    error.code = "bad_api_config";
    throw error;
  }

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  const url = new URL(value);

  if (url.hostname === "rapidapi.com" || url.hostname === "www.rapidapi.com") {
    const error = new Error("L'URL API ne doit pas être rapidapi.com. Utilisez l'endpoint technique fourni dans l'onglet Playground, par exemple https://api-de-plaque-d-immatriculation-france.p.rapidapi.com/");
    error.code = "bad_api_config";
    throw error;
  }

  return url.toString();
}

function isRapidApiEndpoint(url) {
  return url.hostname.endsWith(".rapidapi.com");
}

function normalizeNumberText(value) {
  const match = String(value || "").match(/\d+/);
  return match ? match[0] : "";
}

function pick(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }

  return "";
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(ROOT, requestPath));

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    if (request.method === "HEAD") response.end();
    else response.end(content);
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10000) request.destroy();
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function normalizePlate(plate) {
  const clean = String(plate).toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(clean)) {
    return `${clean.slice(0, 2)}-${clean.slice(2, 5)}-${clean.slice(5)}`;
  }

  return String(plate).toUpperCase().trim();
}

function isValidFrenchPlate(plate) {
  const clean = plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(clean);
}

function loadEnvFile(fileName) {
  const envPath = path.join(ROOT, fileName);
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
