import { NextResponse } from "next/server";

type VehicleInfo = {
  brand: string;
  model: string;
  version: string;
  fuel: string;
  fiscalPower: string;
  horsePower: string;
  year: string;
  co2: string;
};

type CacheEntry = {
  createdAt: number;
  data: VehicleInfo | null;
};

const CACHE_TTL = 1000 * 60 * 60 * 24;
const vehicleCache = new Map<string, CacheEntry>();

export async function POST(request: Request) {
  let body: { plate?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Corps JSON invalide." },
      { status: 400 }
    );
  }

  const plate = normalizePlate(body.plate || "");

  if (!isValidFrenchPlate(plate)) {
    return NextResponse.json(
      { error: "invalid_plate", message: "Plaque française invalide." },
      { status: 400 }
    );
  }

  try {
    const vehicle = await getVehicleByPlate(plate);

    if (!vehicle) {
      return NextResponse.json(
        { error: "not_found", message: "Aucun véhicule trouvé pour cette plaque." },
        { status: 404 }
      );
    }

    return NextResponse.json(vehicle);
  } catch (error) {
    if (isRouteError(error, "missing_key")) {
      return NextResponse.json(
        { error: "missing_api_key", message: "Clé RAPIDAPI_KEY manquante côté serveur." },
        { status: 500 }
      );
    }

    if (isRouteError(error, "bad_api_config")) {
      return NextResponse.json(
        { error: "bad_api_config", message: error.message },
        { status: 500 }
      );
    }

    if (isRouteError(error, "quota_exceeded")) {
      return NextResponse.json(
        { error: "quota_exceeded", message: "Quota API dépassé." },
        { status: error.status || 429 }
      );
    }

    if (isRouteError(error, "api_timeout")) {
      return NextResponse.json(
        { error: "api_timeout", message: "L'API RapidAPI ne répond pas." },
        { status: 504 }
      );
    }

    if (isRouteError(error, "api_error")) {
      return NextResponse.json(
        { error: "api_error", message: error.message || "Erreur API." },
        { status: error.status || 502 }
      );
    }

    return NextResponse.json(
      { error: "server_error", message: "Erreur serveur." },
      { status: 500 }
    );
  }
}

export async function getVehicleByPlate(plate: string): Promise<VehicleInfo | null> {
  const normalizedPlate = normalizePlate(plate);
  const cached = vehicleCache.get(normalizedPlate);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL) {
    return cached.data;
  }

  const apiKey = process.env.RAPIDAPI_KEY;
  const apiHost = process.env.RAPIDAPI_HOST;

  if (!apiKey || apiKey.includes("votre_cle_api_ici")) {
    throw createRouteError("missing_key", "RAPIDAPI_KEY manquante.");
  }

  if (!apiHost) {
    throw createRouteError("bad_api_config", "RAPIDAPI_HOST manquant.");
  }

  const endpoint = normalizeApiEndpoint(
    process.env.API_PLAQUE_URL ||
      `https://${apiHost}/`
  );
  const plateParam = process.env.API_PLAQUE_PARAM || "immatriculation";
  const url = new URL(endpoint);
  url.searchParams.set(plateParam, normalizedPlate.replace(/-/g, ""));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  let apiResponse: Response;

  try {
    apiResponse = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": apiHost
      },
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw createRouteError("api_timeout", "Timeout API RapidAPI.", 504);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (apiResponse.status === 204 || apiResponse.status === 404) {
    vehicleCache.set(normalizedPlate, { createdAt: Date.now(), data: null });
    return null;
  }

  if ([401, 403, 429].includes(apiResponse.status)) {
    throw createRouteError("quota_exceeded", "Quota API dépassé ou accès refusé.", apiResponse.status);
  }

  if (!apiResponse.ok) {
    throw createRouteError("api_error", `Erreur API: ${apiResponse.status}`, apiResponse.status);
  }

  const raw = await apiResponse.json();
  const vehicle = mapVehicleResponse(raw);

  vehicleCache.set(normalizedPlate, { createdAt: Date.now(), data: vehicle });
  return vehicle;
}

function mapVehicleResponse(raw: unknown): VehicleInfo | null {
  const source = getObjectSource(raw);
  const vehicle: VehicleInfo = {
    brand: pick(source, ["brand", "make", "marque", "Marque"]),
    model: pick(source, ["model", "modele", "modèle", "Modele", "Modèle"]),
    version: pick(source, ["version", "variant", "f_version", "Version"]),
    fuel: pick(source, ["fuel", "carburant", "energie", "énergie", "Energy"]),
    fiscalPower: normalizeNumberText(
      pick(source, ["fiscalPower", "puissance_fiscale", "puissanceFiscale", "cv", "CV"])
    ),
    horsePower: pick(source, ["horsePower", "power", "puissance_moteur", "puissance", "kw", "ch"]),
    year: normalizeYear(
      pick(source, ["year", "annee", "année", "mise_en_circulation", "dateMiseCirculation", "firstRegistrationDate"])
    ),
    co2: pick(source, ["co2", "co2Emissions", "emissionsCO2", "emissions_co2", "tauxCo2"])
  };

  return Object.values(vehicle).some(Boolean) ? vehicle : null;
}

function getObjectSource(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) {
    return (raw[0] as Record<string, unknown>) || {};
  }

  if (!raw || typeof raw !== "object") return {};

  const object = raw as Record<string, unknown>;
  const nested = object.data || object.result || object.vehicle || object.vehicule || object.response;

  if (Array.isArray(nested)) {
    return (nested[0] as Record<string, unknown>) || {};
  }

  if (nested && typeof nested === "object") {
    return nested as Record<string, unknown>;
  }

  return object;
}

function normalizeApiEndpoint(endpoint: string) {
  let value = String(endpoint || "").trim();

  if (!value) {
    throw createRouteError("bad_api_config", "URL API manquante.");
  }

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  const url = new URL(value);

  if (url.hostname === "rapidapi.com" || url.hostname === "www.rapidapi.com") {
    throw createRouteError(
      "bad_api_config",
      "L'URL API ne doit pas être rapidapi.com. Utilisez l'endpoint technique fourni dans l'onglet Playground, par exemple https://api-de-plaque-d-immatriculation-france.p.rapidapi.com/"
    );
  }

  return url.toString();
}

function isRapidApiEndpoint(url: URL) {
  return url.hostname.endsWith(".rapidapi.com");
}

function pick(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }

  return "";
}

function normalizePlate(plate: string) {
  const clean = String(plate).toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(clean)) {
    return `${clean.slice(0, 2)}-${clean.slice(2, 5)}-${clean.slice(5)}`;
  }

  return String(plate).toUpperCase().trim();
}

function isValidFrenchPlate(plate: string) {
  const clean = plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(clean);
}

function normalizeNumberText(value: string) {
  const match = String(value || "").match(/\d+/);
  return match ? match[0] : "";
}

function normalizeYear(value: string) {
  if (!value) return "";
  const match = String(value).match(/\d{4}/);
  return match ? match[0] : value;
}

function createRouteError(code: string, message: string, status?: number) {
  const error = new Error(message) as Error & { code: string; status?: number };
  error.code = code;
  error.status = status;
  return error;
}

function isRouteError(
  error: unknown,
  code: string
): error is Error & { code: string; status?: number } {
  return error instanceof Error && "code" in error && error.code === code;
}
