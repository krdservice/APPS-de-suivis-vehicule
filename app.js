const STORAGE_KEY = "entretien-auto-state-v2";

const defaultState = {
  users: [],
  user: null,
  vehicles: [],
  activeVehicleId: null,
  activeDetailTab: "history"
};

const maintenanceTypes = [
  { id: "vidange", label: "Vidange moteur", description: "Remplacement de l'huile moteur", icon: "oil" },
  { id: "filtre-huile", label: "Filtre à huile", description: "Changement du filtre", icon: "filter" },
  { id: "filtre-air", label: "Filtre à air", description: "Remplacement du filtre à air", icon: "air" },
  { id: "filtre-habitacle", label: "Filtre habitacle", description: "Remplacement du filtre de climatisation", icon: "cabin" },
  { id: "boite", label: "Boîte de vitesses", description: "Entretien ou vidange de la boîte", icon: "gear" },
  { id: "frein-liquide", label: "Liquide de frein", description: "Remplacement du liquide", icon: "drop" },
  { id: "refroidissement", label: "Liquide de refroidissement", description: "Contrôle et remplacement", icon: "coolant" },
  { id: "courroie", label: "Courroie de distribution", description: "Contrôle et changement", icon: "belt" },
  { id: "bougies", label: "Bougies", description: "Remplacement des bougies", icon: "spark" },
  { id: "batterie", label: "Batterie", description: "Contrôle et remplacement", icon: "battery" },
  { id: "pneus", label: "Pneus", description: "Rotation ou remplacement", icon: "tire" },
  { id: "freins", label: "Freins", description: "Plaquettes et disques", icon: "brake" }
];

const vehicleSamples = [
  { brand: "Peugeot", model: "308", year: 2021, engine: "1.5 BlueHDi 130", fiscalPower: 6, fuel: "Diesel", color: "Gris Artense" },
  { brand: "Renault", model: "Clio V", year: 2020, engine: "1.0 TCe 100", fiscalPower: 5, fuel: "Essence", color: "Bleu Iron" },
  { brand: "Citroën", model: "C3", year: 2019, engine: "1.2 PureTech 82", fiscalPower: 4, fuel: "Essence", color: "Blanc Banquise" },
  { brand: "Volkswagen", model: "Golf", year: 2022, engine: "2.0 TDI 150", fiscalPower: 7, fuel: "Diesel", color: "Noir Intense" },
  { brand: "Toyota", model: "Yaris", year: 2023, engine: "Hybride 116h", fiscalPower: 4, fuel: "Hybride", color: "Rouge Fusion" },
  { brand: "Tesla", model: "Model 3", year: 2022, engine: "Propulsion électrique", fiscalPower: 7, fuel: "Électrique", color: "Blanc nacré" }
];

let state = migrateState(loadState());
let plateLookupTimer = null;
let lastLookupPlate = "";

const $ = (selector) => document.querySelector(selector);
const app = $("#app");
const authScreen = $("#authScreen");
const dashboardScreen = $("#dashboardScreen");
const detailScreen = $("#detailScreen");
const vehicleList = $("#vehicleList");
const serviceList = $("#serviceList");
const invoiceList = $("#invoiceList");
const toast = $("#toast");

const formatCurrency = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const formatDate = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" });

init();

function init() {
  saveState();
  bindEvents();
  renderMaintenanceGrid();
  updateToday();
  state.user ? showDashboard() : showAuth();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

function bindEvents() {
  $("#showLogin").addEventListener("click", () => setAuthMode("login"));
  $("#showSignup").addEventListener("click", () => setAuthMode("signup"));
  $("#loginForm").addEventListener("submit", handleLogin);
  $("#signupForm").addEventListener("submit", handleSignup);
  $("#logoutButton").addEventListener("click", handleLogout);

  $("#openVehicleSheet").addEventListener("click", () => openSheet("vehicleSheet"));
  $("#addVehicleInline").addEventListener("click", () => openSheet("vehicleSheet"));
  $("#quickAddVehicle").addEventListener("click", () => openSheet("vehicleSheet"));
  $("#quickRevision").addEventListener("click", openRevisionFromDashboard);
  $("#quickInvoices").addEventListener("click", openInvoicesFromDashboard);
  $("#quickStats").addEventListener("click", () => document.getElementById("expensePanel")?.scrollIntoView({ behavior: "smooth" }));
  $("#vehicleForm").addEventListener("submit", handleVehicleSubmit);
  $("#vehiclePlate").addEventListener("input", handlePlateInput);
  $("#lookupPlateButton").addEventListener("click", lookupPlate);

  $("#openRevisionSheet").addEventListener("click", () => openSheet("revisionSheet"));
  $("#revisionForm").addEventListener("submit", handleRevisionSubmit);
  $("#openInvoiceSheet").addEventListener("click", () => openSheet("invoiceSheet"));
  $("#invoiceForm").addEventListener("submit", handleInvoiceSubmit);
  $("#backToDashboard").addEventListener("click", showDashboard);
  $("#deleteVehicle").addEventListener("click", deleteActiveVehicle);

  document.querySelectorAll("[data-close-sheet]").forEach((button) => {
    button.addEventListener("click", () => closeSheet(button.dataset.closeSheet));
  });

  document.querySelectorAll(".sheet-backdrop").forEach((sheet) => {
    sheet.addEventListener("click", (event) => {
      if (event.target === sheet) closeSheet(sheet.id);
    });
  });

  document.querySelectorAll(".detail-tabs button").forEach((button) => {
    button.addEventListener("click", () => setDetailTab(button.dataset.tab));
  });
}

function setAuthMode(mode) {
  const isLogin = mode === "login";
  $("#loginForm").classList.toggle("hidden", !isLogin);
  $("#signupForm").classList.toggle("hidden", isLogin);
  $("#showLogin").classList.toggle("active", isLogin);
  $("#showSignup").classList.toggle("active", !isLogin);
}

function handleSignup(event) {
  event.preventDefault();
  const name = $("#signupName").value.trim();
  const email = $("#signupEmail").value.trim().toLowerCase();
  const pin = $("#signupPin").value.trim();

  if (!name || !email || pin.length < 4) {
    showToast("Inscription incomplète");
    return;
  }

  const existing = state.users.find((user) => user.email === email);
  if (existing) {
    showToast("Ce compte existe déjà");
    return;
  }

  const user = { id: createId(), name, email, pin, vehicles: [], createdAt: new Date().toISOString() };
  state.users.push(user);
  state.user = { id: user.id, name: user.name, email: user.email };
  saveState();
  $("#signupForm").reset();
  showDashboard();
  showToast("Compte créé");
}

function handleLogin(event) {
  event.preventDefault();
  const email = $("#loginEmail").value.trim().toLowerCase();
  const pin = $("#loginPin").value.trim();
  const user = state.users.find((item) => item.email === email && item.pin === pin);

  if (!user) {
    showToast("Identifiants incorrects");
    return;
  }

  state.user = { id: user.id, name: user.name, email: user.email };
  saveState();
  showDashboard();
  showToast("Connexion réussie");
}

function handleLogout() {
  state.user = null;
  state.activeVehicleId = null;
  saveState();
  showAuth();
}

function handlePlateInput(event) {
  event.target.value = formatPlate(event.target.value);
  $("#plateLookupStatus").textContent = "";

  clearTimeout(plateLookupTimer);
  const plate = formatPlate(event.target.value);

  if (isValidPlate(plate)) {
    plateLookupTimer = setTimeout(() => lookupPlate(), 650);
  }
}

async function lookupPlate() {
  const plate = formatPlate($("#vehiclePlate").value);

  if (!isValidPlate(plate)) {
    showToast("Plaque à vérifier");
    return;
  }

  if (plate === lastLookupPlate && $("#vehicleBrand").value) return;

  lastLookupPlate = plate;
  $("#plateLookupStatus").textContent = "Recherche du véhicule...";
  $("#lookupPlateButton").disabled = true;

  try {
    const data = await fetchVehicleByPlate(plate);
    fillVehicleForm(data);
    $("#plateLookupStatus").textContent = "Informations récupérées depuis l'API. À vérifier avant enregistrement.";
    showToast("Informations récupérées");
  } catch (error) {
    lastLookupPlate = "";
    $("#plateLookupStatus").textContent = error.message;
    showToast(error.message);
  } finally {
    $("#lookupPlateButton").disabled = false;
  }
}

function handleVehicleSubmit(event) {
  event.preventDefault();
  const plate = formatPlate($("#vehiclePlate").value);

  if (!isValidPlate(plate)) {
    showToast("Plaque à vérifier");
    return;
  }

  const vehicle = {
    id: createId(),
    plate,
    brand: $("#vehicleBrand").value.trim(),
    model: $("#vehicleModel").value.trim(),
    version: $("#vehicleVersion").value.trim(),
    year: numberOrNull($("#vehicleYear").value),
    mileage: Number($("#vehicleMileage").value) || 0,
    engine: $("#vehicleEngine").value.trim(),
    fiscalPower: numberOrNull($("#vehicleFiscalPower").value),
    horsePower: $("#vehicleHorsePower").value.trim(),
    co2: $("#vehicleCo2").value.trim(),
    fuel: $("#vehicleFuel").value.trim(),
    color: $("#vehicleColor").value.trim(),
    nextService: $("#vehicleNextService").value || "",
    ownerId: state.user.id,
    services: [],
    invoices: [],
    createdAt: new Date().toISOString()
  };

  getCurrentUserRecord().vehicles.unshift(vehicle);
  state.activeVehicleId = vehicle.id;
  saveState();
  $("#vehicleForm").reset();
  $("#plateLookupStatus").textContent = "";
  lastLookupPlate = "";
  closeSheet("vehicleSheet");
  showVehicleDetail(vehicle.id);
  showToast("Véhicule ajouté");
}

async function handleRevisionSubmit(event) {
  event.preventDefault();
  const vehicle = getActiveVehicle();
  if (!vehicle) return;

  const typeId = $("#serviceType").value;
  const type = maintenanceTypes.find((item) => item.id === typeId);

  if (!type) {
    showToast("Choisissez une révision");
    return;
  }

  const serviceMileage = numberOrNull($("#serviceMileage").value);
  const nextService = $("#serviceNext").value || "";
  let revisionInvoice = null;
  try {
    revisionInvoice = await createRevisionInvoiceIfNeeded(vehicle, type.label);
  } catch {
    showToast("Import de facture impossible");
    return;
  }

  const service = {
    id: createId(),
    typeId: type.id,
    type: type.label,
    description: type.description,
    date: $("#serviceDate").value,
    mileage: serviceMileage,
    cost: Number($("#serviceCost").value) || 0,
    nextService,
    invoiceId: revisionInvoice?.id || $("#serviceInvoice").value || "",
    notes: $("#serviceNotes").value.trim(),
    createdAt: new Date().toISOString()
  };

  vehicle.services.unshift(service);
  if (serviceMileage && serviceMileage > vehicle.mileage) vehicle.mileage = serviceMileage;
  if (nextService) vehicle.nextService = nextService;

  saveState();
  $("#revisionForm").reset();
  clearMaintenanceSelection();
  closeSheet("revisionSheet");
  renderDetail(vehicle);
  showToast(revisionInvoice ? "Révision et facture enregistrées" : "Révision enregistrée");
}

async function handleInvoiceSubmit(event) {
  event.preventDefault();
  const vehicle = getActiveVehicle();
  const file = $("#invoicePdf").files[0];

  if (!vehicle || !file) return;
  if (file.type !== "application/pdf") {
    showToast("PDF uniquement");
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const invoice = {
      id: createId(),
      name: $("#invoiceName").value.trim(),
      date: $("#invoiceDate").value,
      amount: Number($("#invoiceAmount").value) || 0,
      fileName: file.name,
      fileSize: file.size,
      dataUrl,
      createdAt: new Date().toISOString()
    };

    vehicle.invoices.unshift(invoice);
    saveState();
    $("#invoiceForm").reset();
    closeSheet("invoiceSheet");
    renderDetail(vehicle);
    showToast("Facture ajoutée");
  } catch {
    showToast("Import impossible");
  }
}

async function createRevisionInvoiceIfNeeded(vehicle, revisionLabel) {
  const file = $("#revisionInvoicePdf").files[0];

  if (!file) return null;

  if (file.type !== "application/pdf") {
    throw new Error("PDF uniquement");
  }

  const amount = Number($("#serviceCost").value) || 0;
  const date = $("#serviceDate").value;
  const dataUrl = await readFileAsDataUrl(file);
  const invoice = {
    id: createId(),
    name: `Facture ${revisionLabel}`,
    date,
    amount,
    fileName: file.name,
    fileSize: file.size,
    dataUrl,
    createdAt: new Date().toISOString()
  };

  vehicle.invoices.unshift(invoice);
  return invoice;
}

function openRevisionFromDashboard() {
  const vehicle = getUserVehicles()[0];

  if (!vehicle) {
    openSheet("vehicleSheet");
    return;
  }

  showVehicleDetail(vehicle.id);
  setTimeout(() => openSheet("revisionSheet"), 120);
}

function openInvoicesFromDashboard() {
  const vehicle = getUserVehicles()[0];

  if (!vehicle) {
    openSheet("vehicleSheet");
    return;
  }

  showVehicleDetail(vehicle.id);
  setTimeout(() => {
    setDetailTab("invoices");
  }, 120);
}

function showAuth() {
  app.classList.add("auth-mode");
  toggleScreen(authScreen, true);
  toggleScreen(dashboardScreen, false);
  toggleScreen(detailScreen, false);
  setAuthMode(state.users.length ? "login" : "signup");
}

function showDashboard() {
  app.classList.remove("auth-mode");
  state.activeVehicleId = null;
  saveState();
  toggleScreen(authScreen, false);
  toggleScreen(detailScreen, false);
  toggleScreen(dashboardScreen, true);
  renderDashboard();
}

function showVehicleDetail(vehicleId) {
  const vehicle = getUserVehicles().find((item) => item.id === vehicleId);
  if (!vehicle) {
    showDashboard();
    return;
  }

  state.activeVehicleId = vehicleId;
  saveState();
  toggleScreen(authScreen, false);
  toggleScreen(dashboardScreen, false);
  toggleScreen(detailScreen, true);
  renderDetail(vehicle);
}

function renderDashboard() {
  const vehicles = getUserVehicles();
  const firstName = state.user?.name?.split(" ")[0] || "Garage";
  $("#helloTitle").textContent = `Bonjour ${firstName}`;
  $("#vehicleCount").textContent = String(vehicles.length);
  $("#upcomingCount").textContent = String(countUpcomingServices());
  $("#invoiceCount").textContent = String(getInvoiceCount());
  $("#totalCost").textContent = formatCurrency.format(getTotalCost());
  renderDashboardHero(vehicles);
  renderAlerts();
  renderExpensePanel();

  if (!vehicles.length) {
    vehicleList.innerHTML = `<div class="empty-state"><div><strong>Aucun véhicule</strong><p>Ajoutez votre premier véhicule avec sa plaque.</p></div></div>`;
    return;
  }

  vehicleList.innerHTML = vehicles.map(renderVehicleCard).join("");
  vehicleList.querySelectorAll(".vehicle-card").forEach((card) => {
    card.addEventListener("click", () => showVehicleDetail(card.dataset.id));
  });
}

function renderVehicleCard(vehicle) {
  const nextService = vehicle.nextService ? readableDate(vehicle.nextService) : "Non définie";
  const mileage = vehicle.mileage ? `${formatNumber(vehicle.mileage)} km` : "Kilométrage non renseigné";
  const model = getVehicleName(vehicle);
  const cost = getVehicleCost(vehicle);

  return `
    <button class="vehicle-card" type="button" data-id="${vehicle.id}">
      <span class="vehicle-card-head">
        <span class="vehicle-name">
          <strong>${escapeHtml(model)}</strong>
          <span>${escapeHtml([vehicle.version, vehicle.engine, vehicle.fuel].filter(Boolean).join(" · ") || String(vehicle.year || ""))}</span>
        </span>
        <span class="plate-badge">${escapeHtml(vehicle.plate)}</span>
      </span>
      <span class="vehicle-meta">
        <span><svg aria-hidden="true"><use href="#icon-car"></use></svg>${mileage}</span>
        <span><svg aria-hidden="true"><use href="#icon-calendar"></use></svg>${nextService}</span>
        <span><svg aria-hidden="true"><use href="#icon-file"></use></svg>${formatCurrency.format(cost)}</span>
      </span>
    </button>
  `;
}

function renderDashboardHero(vehicles) {
  const hero = $("#dashboardHero");
  const vehicle = vehicles[0];

  if (!vehicle) {
    hero.innerHTML = `
      <div class="hero-copy">
        <span>Garage personnel</span>
        <h2>Ajoutez votre premier véhicule</h2>
        <p>Vos révisions, factures et alertes resteront liées à votre compte uniquement.</p>
      </div>
    `;
    return;
  }

  const lastInvoice = getLatestInvoice(vehicle);
  hero.innerHTML = `
    <img src="${getVehiclePhoto(vehicle, "front")}" alt="${escapeHtml(getVehicleName(vehicle))}">
    <div class="hero-overlay"></div>
    <div class="hero-copy">
      <span>Véhicule principal</span>
      <h2>${escapeHtml(getVehicleName(vehicle))}</h2>
      <p>${formatNumber(vehicle.mileage || 0)} km · ${vehicle.nextService ? `Révision ${readableDate(vehicle.nextService)}` : "Révision à planifier"}</p>
    </div>
    <div class="hero-stats">
      <article><strong>${formatCurrency.format(getVehicleAnnualCost(vehicle))}</strong><span>Dépenses annuelles</span></article>
      <article><strong>${lastInvoice ? escapeHtml(lastInvoice.name) : "Aucune"}</strong><span>Dernière facture</span></article>
    </div>
  `;
}

function renderDetail(vehicle) {
  $("#detailTitle").textContent = getVehicleName(vehicle);
  $("#detailPlate").textContent = vehicle.plate;
  $("#detailPlateBadge").textContent = vehicle.plate;
  $("#detailMeta").textContent = [vehicle.version, vehicle.year, vehicle.engine, vehicle.fuel, vehicle.color].filter(Boolean).join(" · ") || "Fiche véhicule";
  $("#detailMileage").textContent = `${formatNumber(vehicle.mileage || 0)} km`;
  renderVehicleGallery(vehicle);
  renderInfoGrid(vehicle);
  renderServices(vehicle);
  renderInvoices(vehicle);
  setDetailTab(state.activeDetailTab || "history");
}

function renderVehicleGallery(vehicle) {
  const views = [
    ["Vue avant", "front"],
    ["Vue arrière", "rear"],
    ["Vue de profil", "side"]
  ];

  $("#vehicleGallery").innerHTML = views.map(([label, view]) => `
    <article class="vehicle-view">
      <img src="${getVehiclePhoto(vehicle, view)}" alt="${escapeHtml(`${getVehicleName(vehicle)} ${label}`)}">
      <span>${label}</span>
    </article>
  `).join("");
}

function renderInfoGrid(vehicle) {
  const items = [
    ["Marque", vehicle.brand],
    ["Modèle", vehicle.model],
    ["Version", vehicle.version],
    ["Année", vehicle.year],
    ["Motorisation", vehicle.engine],
    ["Puissance fiscale", vehicle.fiscalPower ? `${vehicle.fiscalPower} CV` : ""],
    ["Puissance moteur", vehicle.horsePower],
    ["Émissions CO2", vehicle.co2],
    ["Carburant", vehicle.fuel],
    ["Couleur", vehicle.color],
    ["Prochaine révision", vehicle.nextService ? readableDate(vehicle.nextService) : ""]
  ];

  $("#vehicleInfoGrid").innerHTML = items.map(([label, value]) => `
    <article><span>${label}</span><strong>${escapeHtml(value || "Non renseigné")}</strong></article>
  `).join("");
}

function renderServices(vehicle) {
  if (!vehicle.services.length) {
    serviceList.innerHTML = `<div class="empty-state"><div><strong>Aucun entretien</strong><p>Utilisez le bouton de révision pour enregistrer une opération.</p></div></div>`;
    return;
  }

  serviceList.innerHTML = vehicle.services.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map((service) => {
    const type = maintenanceTypes.find((item) => item.id === service.typeId) || maintenanceTypes[0];
    const invoice = vehicle.invoices.find((item) => item.id === service.invoiceId);
    const details = [
      service.mileage ? `${formatNumber(service.mileage)} km` : "",
      service.cost ? formatCurrency.format(service.cost) : "",
      invoice ? `Facture: ${invoice.name}` : "",
      service.nextService ? `Prochaine: ${readableDate(service.nextService)}` : ""
    ].filter(Boolean).join(" · ");

    return `
      <article class="service-card rich">
        <span class="maintenance-icon">${renderMaintenanceIcon(type.icon)}</span>
        <div>
          <header><strong>${escapeHtml(service.type)}</strong><time>${readableDate(service.date)}</time></header>
          <p>${escapeHtml(service.description || type.description)}</p>
          ${details ? `<p>${escapeHtml(details)}</p>` : ""}
          ${service.notes ? `<p>${escapeHtml(service.notes)}</p>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function renderInvoices(vehicle) {
  if (!vehicle.invoices.length) {
    invoiceList.innerHTML = `<div class="empty-state"><div><strong>Aucune facture</strong><p>Importez une facture PDF pour ce véhicule.</p></div></div>`;
    return;
  }

  invoiceList.innerHTML = vehicle.invoices.map((invoice) => `
    <article class="invoice-card">
      <span class="maintenance-icon">${renderMaintenanceIcon("file")}</span>
      <div>
        <header><strong>${escapeHtml(invoice.name)}</strong><time>${readableDate(invoice.date)}</time></header>
        <p>${formatCurrency.format(invoice.amount || 0)} · ${escapeHtml(invoice.fileName)}</p>
        <div class="inline-actions">
          <a href="${invoice.dataUrl}" target="_blank" rel="noreferrer"><svg aria-hidden="true"><use href="#icon-eye"></use></svg>Aperçu</a>
          <a href="${invoice.dataUrl}" download="${escapeHtml(invoice.fileName)}"><svg aria-hidden="true"><use href="#icon-download"></use></svg>Télécharger</a>
        </div>
      </div>
    </article>
  `).join("");
}

function renderMaintenanceGrid() {
  $("#maintenanceGrid").innerHTML = maintenanceTypes.map((type) => `
    <button class="maintenance-option" type="button" data-type="${type.id}">
      <span>${renderMaintenanceIcon(type.icon)}</span>
      <strong>${type.label}</strong>
      <small>${type.description}</small>
    </button>
  `).join("");

  $("#maintenanceGrid").querySelectorAll(".maintenance-option").forEach((button) => {
    button.addEventListener("click", () => {
      $("#serviceType").value = button.dataset.type;
      document.querySelectorAll(".maintenance-option").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
    });
  });
}

function renderAlerts() {
  const alerts = getUserVehicles().filter((vehicle) => vehicle.nextService && new Date(`${vehicle.nextService}T12:00:00`) <= addDays(new Date(), 60));
  const panel = $("#alertPanel");
  panel.classList.toggle("hidden", alerts.length === 0);
  panel.innerHTML = alerts.length ? `<strong>Alertes d'entretien</strong>${alerts.map((vehicle) => `<p>${escapeHtml(getVehicleName(vehicle))} · ${readableDate(vehicle.nextService)}</p>`).join("")}` : "";
}

function renderExpensePanel() {
  const panel = $("#expensePanel");
  const vehiclesWithCost = getUserVehicles().filter((vehicle) => getVehicleCost(vehicle) > 0);
  panel.classList.toggle("hidden", vehiclesWithCost.length === 0);
  panel.innerHTML = vehiclesWithCost.length ? `<strong>Dépenses par véhicule</strong>${vehiclesWithCost.map((vehicle) => `<p>${escapeHtml(getVehicleName(vehicle))}<span>${formatCurrency.format(getVehicleCost(vehicle))}</span></p>`).join("")}` : "";
}

function openSheet(id) {
  const sheet = document.getElementById(id);
  sheet.classList.remove("hidden");
  sheet.setAttribute("aria-hidden", "false");

  if (id === "revisionSheet") {
    $("#serviceDate").valueAsDate = new Date();
    fillInvoiceSelect();
  }

  if (id === "invoiceSheet") $("#invoiceDate").valueAsDate = new Date();

  setTimeout(() => sheet.querySelector("input, select, textarea, button")?.focus(), 80);
}

function closeSheet(id) {
  const sheet = document.getElementById(id);
  sheet.classList.add("hidden");
  sheet.setAttribute("aria-hidden", "true");
}

function setDetailTab(tab) {
  state.activeDetailTab = tab;
  saveState();
  document.querySelectorAll(".detail-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $("#historyTab").classList.toggle("hidden", tab !== "history");
  $("#invoicesTab").classList.toggle("hidden", tab !== "invoices");
  $("#infoTab").classList.toggle("hidden", tab !== "info");
}

function fillInvoiceSelect() {
  const vehicle = getActiveVehicle();
  const select = $("#serviceInvoice");
  const options = vehicle?.invoices?.map((invoice) => `<option value="${invoice.id}">${escapeHtml(invoice.name)} · ${readableDate(invoice.date)}</option>`).join("") || "";
  select.innerHTML = `<option value="">Aucune facture associée</option>${options}`;
}

function fillVehicleForm(data) {
  $("#vehicleBrand").value = data.brand || "";
  $("#vehicleModel").value = data.model || "";
  $("#vehicleVersion").value = data.version || "";
  $("#vehicleYear").value = data.year || "";
  $("#vehicleEngine").value = data.engine || "";
  $("#vehicleFiscalPower").value = data.fiscalPower || "";
  $("#vehicleHorsePower").value = data.horsePower || "";
  $("#vehicleCo2").value = data.co2 || "";
  $("#vehicleFuel").value = data.fuel || "";
  $("#vehicleColor").value = data.color || $("#vehicleColor").value;
}

async function fetchVehicleByPlate(plate) {
  const response = await fetch("/api/vehicle-by-plate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plate })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || "Recherche impossible.");
  }

  return payload;
}

function deleteActiveVehicle() {
  const vehicle = getActiveVehicle();
  if (!vehicle) return;
  if (!window.confirm(`Supprimer ${vehicle.plate} ?`)) return;
  const user = getCurrentUserRecord();
  user.vehicles = user.vehicles.filter((item) => item.id !== vehicle.id);
  state.activeVehicleId = null;
  saveState();
  showDashboard();
  showToast("Véhicule supprimé");
}

function clearMaintenanceSelection() {
  document.querySelectorAll(".maintenance-option").forEach((item) => item.classList.remove("selected"));
}

function getUserVehicles() {
  return getCurrentUserRecord()?.vehicles || [];
}

function getCurrentUserRecord() {
  if (!state.user) return null;
  return state.users.find((user) => user.id === state.user.id) || null;
}

function getActiveVehicle() {
  return getUserVehicles().find((vehicle) => vehicle.id === state.activeVehicleId);
}

function getVehicleName(vehicle) {
  return [vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "Véhicule";
}

function getVehicleCost(vehicle) {
  const services = vehicle.services?.reduce((sum, service) => sum + (service.cost || 0), 0) || 0;
  const invoiceOnly = vehicle.invoices?.reduce((sum, invoice) => sum + (invoice.amount || 0), 0) || 0;
  return Math.max(services, invoiceOnly);
}

function countUpcomingServices() {
  return getUserVehicles().filter((vehicle) => {
    if (!vehicle.nextService) return false;
    return new Date(`${vehicle.nextService}T12:00:00`) <= addDays(new Date(), 60);
  }).length;
}

function getInvoiceCount() {
  return getUserVehicles().reduce((sum, vehicle) => sum + (vehicle.invoices?.length || 0), 0);
}

function getTotalCost() {
  return getUserVehicles().reduce((sum, vehicle) => sum + getVehicleCost(vehicle), 0);
}

function toggleScreen(screen, visible) {
  screen.classList.toggle("hidden", !visible);
  screen.setAttribute("aria-hidden", visible ? "false" : "true");
}

function updateToday() {
  $("#todayLabel").textContent = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "2-digit", month: "long" }).format(new Date());
}

function formatPlate(value) {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(clean)) return `${clean.slice(0, 2)}-${clean.slice(2, 5)}-${clean.slice(5)}`;
  return value.toUpperCase().replace(/[^A-Z0-9 -]/g, "").slice(0, 12);
}

function isValidPlate(plate) {
  return /^[A-Z]{2}-?\d{3}-?[A-Z]{2}$/.test(plate.toUpperCase().replace(/\s/g, ""));
}

function readableDate(date) {
  if (!date) return "";
  return formatDate.format(new Date(`${date}T12:00:00`));
}

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR").format(Number(value) || 0);
}

function numberOrNull(value) {
  return value === "" ? null : Number(value);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadState() {
  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (current) return current;
    const oldState = JSON.parse(localStorage.getItem("entretien-auto-state-v1"));
    return oldState || { ...defaultState };
  } catch {
    try {
      const oldState = JSON.parse(localStorage.getItem("entretien-auto-state-v1"));
      return oldState || { ...defaultState };
    } catch {
      return { ...defaultState };
    }
  }
}

function migrateState(saved) {
  const migrated = { ...defaultState, ...saved };
  migrated.users = migrated.users || [];

  if (saved?.user && !saved.user.email) {
    const user = { id: createId(), name: saved.user.name || "Utilisateur", email: "local@entretien.auto", pin: "1234" };
    migrated.users = [user];
    migrated.user = { id: user.id, name: user.name, email: user.email };
  }

  migrated.users = migrated.users.map((user) => ({
    ...user,
    vehicles: user.vehicles || []
  }));

  const legacyVehicles = (migrated.vehicles || []).map((vehicle) => ({
    ...vehicle,
    ownerId: vehicle.ownerId || migrated.user?.id || "",
    version: vehicle.version || "",
    engine: vehicle.engine || "",
    fiscalPower: vehicle.fiscalPower || null,
    horsePower: vehicle.horsePower || "",
    co2: vehicle.co2 || "",
    fuel: vehicle.fuel || "",
    color: vehicle.color || "",
    services: vehicle.services || [],
    invoices: vehicle.invoices || []
  }));

  legacyVehicles.forEach((vehicle) => {
    const owner = migrated.users.find((user) => user.id === vehicle.ownerId);
    if (!owner) return;
    const alreadyMoved = owner.vehicles.some((item) => item.id === vehicle.id);
    if (!alreadyMoved) owner.vehicles.push(vehicle);
  });

  migrated.vehicles = [];

  return migrated;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2200);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getLatestInvoice(vehicle) {
  return (vehicle.invoices || [])
    .slice()
    .sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt))[0] || null;
}

function getVehicleAnnualCost(vehicle) {
  const currentYear = new Date().getFullYear();
  return (vehicle.services || []).reduce((sum, service) => {
    const year = service.date ? new Date(`${service.date}T12:00:00`).getFullYear() : null;
    return year === currentYear ? sum + (service.cost || 0) : sum;
  }, 0);
}

function getVehiclePhoto(vehicle, view) {
  const query = [vehicle.brand, vehicle.model, vehicle.year, view, "car"].filter(Boolean).join(" ");
  return `https://source.unsplash.com/900x600/?${encodeURIComponent(query)}`;
}

function renderMaintenanceIcon(type) {
  const common = `viewBox="0 0 64 64" aria-hidden="true"`;
  const icons = {
    oil: `<svg ${common}><path d="M24 9h16v10l12 14v17a7 7 0 0 1-7 7H19a7 7 0 0 1-7-7V33l12-14V9Z"/><path d="M24 19h16M22 38h20"/></svg>`,
    filter: `<svg ${common}><path d="M12 16h40L38 33v16l-12 6V33L12 16Z"/><path d="M18 16V9h28v7"/></svg>`,
    air: `<svg ${common}><path d="M10 24h34a7 7 0 1 0-7-7"/><path d="M10 34h42a6 6 0 1 1-6 6"/><path d="M10 44h24"/></svg>`,
    cabin: `<svg ${common}><rect x="12" y="14" width="40" height="36" rx="4"/><path d="M20 22h24M20 32h24M20 42h24"/></svg>`,
    gear: `<svg ${common}><path d="M32 10v9M32 45v9M10 32h9M45 32h9M16 16l7 7M41 41l7 7M48 16l-7 7M23 41l-7 7"/><circle cx="32" cy="32" r="11"/></svg>`,
    drop: `<svg ${common}><path d="M32 8s16 18 16 32a16 16 0 0 1-32 0C16 26 32 8 32 8Z"/><path d="M25 43a8 8 0 0 0 12 0"/></svg>`,
    coolant: `<svg ${common}><path d="M24 8h16v24a12 12 0 1 1-16 0V8Z"/><path d="M32 37v14M24 44h16"/></svg>`,
    belt: `<svg ${common}><path d="M18 18a20 20 0 0 1 28 28"/><path d="M46 18A20 20 0 0 1 18 46"/><circle cx="24" cy="24" r="5"/><circle cx="40" cy="40" r="5"/></svg>`,
    spark: `<svg ${common}><path d="m34 8-15 27h12l-1 21 15-29H33l1-19Z"/></svg>`,
    battery: `<svg ${common}><rect x="10" y="20" width="44" height="28" rx="4"/><path d="M18 20v-6h8v6M38 20v-6h8v6M21 34h10M43 29v10M38 34h10"/></svg>`,
    tire: `<svg ${common}><circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="10"/><path d="M32 10v12M32 42v12M10 32h12M42 32h12"/></svg>`,
    brake: `<svg ${common}><circle cx="32" cy="32" r="20"/><path d="M32 12a20 20 0 0 1 15 33"/><path d="M20 26h24v12H20z"/></svg>`,
    file: `<svg ${common}><path d="M22 8h16l10 10v38H16V8h6Z"/><path d="M38 8v10h10M23 32h18M23 42h14"/></svg>`
  };
  return icons[type] || icons.gear;
}

function carColor(color) {
  const value = (color || "").toLowerCase();
  if (value.includes("rouge")) return "#b94444";
  if (value.includes("bleu")) return "#2f66a3";
  if (value.includes("noir")) return "#20262c";
  if (value.includes("blanc")) return "#f0f4f5";
  if (value.includes("gris")) return "#8a949c";
  return "#087f8c";
}

function renderCarSvg(color, view) {
  if (view === 0) {
    return `<svg viewBox="0 0 120 72" aria-hidden="true"><path d="M34 16h52l12 20v24H22V36l12-20Z" fill="${color}"/><path d="M42 22h36l7 13H35l7-13Z" fill="#d8eef2"/><circle cx="38" cy="56" r="7" fill="#101820"/><circle cx="82" cy="56" r="7" fill="#101820"/></svg>`;
  }
  if (view === 1) {
    return `<svg viewBox="0 0 120 72" aria-hidden="true"><path d="M28 20h64l10 18v22H18V38l10-18Z" fill="${color}"/><path d="M42 26h36l8 12H34l8-12Z" fill="#d8eef2"/><rect x="24" y="47" width="16" height="7" rx="3" fill="#f2a541"/><rect x="80" y="47" width="16" height="7" rx="3" fill="#f2a541"/></svg>`;
  }
  return `<svg viewBox="0 0 140 72" aria-hidden="true"><path d="M20 46h8l12-20h49l17 20h14v12H20V46Z" fill="${color}"/><path d="M44 29h18v17H34l10-17ZM66 29h20l14 17H66V29Z" fill="#d8eef2"/><circle cx="45" cy="58" r="9" fill="#101820"/><circle cx="101" cy="58" r="9" fill="#101820"/></svg>`;
}
