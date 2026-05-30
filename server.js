async function fetchVehicleByPlate(plate) {
const normalizedPlate = normalizePlate(plate);

if (!isValidFrenchPlate(normalizedPlate)) {
const error = new Error("Plaque invalide.");
error.code = "invalid_plate";
throw error;
}

const cached = vehicleCache.get(normalizedPlate);

if (cached && Date.now() - cached.createdAt < CACHE_DURATION_MS) {
return cached.data;
}

const apiKey = process.env.RAPIDAPI_KEY;
const apiHost = process.env.RAPIDAPI_HOST || "api-de-plaque-d-immatriculation-france.p.rapidapi.com";

if (!apiKey) {
const error = new Error("RAPIDAPI_KEY manquante dans .env.local");
error.code = "bad_api_config";
throw error;
}

const apiUrl = `https://${apiHost}/?plaque=${encodeURIComponent(normalizedPlate)}`;

const apiResponse = await fetch(apiUrl, {
method: "GET",
headers: {
"x-rapidapi-key": apiKey,
"x-rapidapi-host": apiHost,
"Content-Type": "application/json"
}
});

if (apiResponse.status === 204 || apiResponse.status === 404) {
vehicleCache.set(normalizedPlate, {
createdAt: Date.now(),
data: null
});

```
return null;
```

}

if (
apiResponse.status === 401 ||
apiResponse.status === 403 ||
apiResponse.status === 429
) {
const error = new Error(
"Quota API dépassé ou accès refusé."
);

```
error.code = "quota_exceeded";
error.status = apiResponse.status;
throw error;
```

}

if (!apiResponse.ok) {
const body = await apiResponse.text().catch(() => "");
const error = new Error(
`Erreur API ${apiResponse.status}: ${body}`
);

```
error.code = "api_error";
error.status = apiResponse.status;
throw error;
```

}

const raw = await apiResponse.json();

console.log("Réponse API plaque :", raw);

const vehicle = mapVehicleResponse(raw);

vehicleCache.set(normalizedPlate, {
createdAt: Date.now(),
data: vehicle
});

return vehicle;
}
