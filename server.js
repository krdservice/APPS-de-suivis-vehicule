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
      sendJson(response, 500, { error: "missing_api_key", message: "Clé API_PLAQUE_KEY manquante côté serveur." });
      return;
    }

    if (error.code === "quota_exceeded") {
      sendJson(response, 429, { error: "quota_exceeded", message: "Quota API dépassé." });
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

  const apiKey = process.env.API_PLAQUE_KEY;

  if (!apiKey || apiKey.includes("votre_cle_api_ici")) {
    const error = new Error("API_PLAQUE_KEY manquante.");
    error.code = "missing_key";
    throw error;
  }

  const endpoint = process.env.API_PLAQUE_URL || "https://api-de-plaque-d-immatriculation-france.p.rapidapi.com/";
  const plateParam = process.env.API_PLAQUE_PARAM || "immatriculation";
  const url = new URL(endpoint);
  url.searchParams.set(plateParam, normalizedPlate.replace(/-/g, ""));

  const headers = {
    Accept: "application/json"
  };

  if (process.env.API_PLAQUE_URL) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
  } else {
    headers["x-rapidapi-key"] = apiKey;
    headers["x-rapidapi-host"] = url.host;
  }

  const apiResponse = await fetch(url, { method: "GET", headers });

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
    const error = new Error(`Erreur API: ${apiResponse.status}`);
    error.code = "api_error";
    error.status = apiResponse.status;
    throw error;
  }

  const raw = await apiResponse.json();
  const vehicle = mapVehicleResponse(raw);

  vehicleCache.set(normalizedPlate, { createdAt: Date.now(), data: vehicle });
  return vehicle;
}

function mapVehicleResponse(raw) {
  const source = raw?.data || raw?.result || raw?.vehicle || raw || {};

  const vehicle = {
    brand: pick(source, ["brand", "make", "marque", "Marque"]),
    model: pick(source, ["model", "modele", "modèle", "Modele", "Modèle"]),
    version: pick(source, ["version", "variant", "f_version", "Version"]),
    fuel: pick(source, ["fuel", "carburant", "energie", "énergie", "Energy"]),
    fiscalPower: pick(source, ["fiscalPower", "puissance_fiscale", "puissanceFiscale", "cv", "CV"]),
    horsePower: pick(source, ["horsePower", "power", "puissance_moteur", "puissance", "kw", "ch"]),
    year: pick(source, ["year", "annee", "année", "mise_en_circulation", "dateMiseCirculation", "firstRegistrationDate"]),
    co2: pick(source, ["co2", "co2Emissions", "emissionsCO2", "emissions_co2", "tauxCo2"])
  };

  vehicle.fiscalPower = normalizeNumberText(vehicle.fiscalPower);

  if (vehicle.year && String(vehicle.year).length > 4) {
    const match = String(vehicle.year).match(/\d{4}/);
    vehicle.year = match ? match[0] : vehicle.year;
  }

  const hasAnyValue = Object.values(vehicle).some((value) => value !== "" && value !== null && value !== undefined);
  return hasAnyValue ? vehicle : null;
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
