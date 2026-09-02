const state = {
  images: [],
  imagesLoading: false,
  records: [],
  stream: null,
  screenStream: null,
  cameraDeviceId: "",
  cameraDevices: [],
  editingRecordId: null,
  ocrText: "",
  detectedType: "",
  detectionReason: "",
  detectedPersonName: "",
  detectedPersonId: "",
  detectedPersonReason: "",
  summaryManuallyEdited: false,
  summaryMode: "research",
  paddleOcr: null,
  paddleOcrPromise: null,
  ocrEngine: "",
  ocrBlocks: [],
  ocrEdited: false,
  ocrOriginalText: "",
  ocrError: "",
  ocrBusy: false,
  currentMetrics: [],
  metricSourceRows: [],
  batchAudit: null,
  appendicitisData: {},
};

const $ = (id) => document.getElementById(id);
const els = {
  cameraStage: $("cameraStage"),
  cameraVideo: $("cameraVideo"),
  cameraPlaceholder: $("cameraPlaceholder"),
  captureCanvas: $("captureCanvas"),
  startCameraButton: $("startCameraButton"),
  takePhotoButton: $("takePhotoButton"),
  cameraDeviceSelect: $("cameraDeviceSelect"),
  refreshCameraDevicesButton: $("refreshCameraDevicesButton"),
  imageInput: $("imageInput"),
  scanScreenButton: $("scanScreenButton"),
  previewStrip: $("previewStrip"),
  captureCount: $("captureCount"),
  recordTitle: $("recordTitle"),
  recordType: $("recordType"),
  personName: $("personName"),
  personId: $("personId"),
  patientMatchHint: $("patientMatchHint"),
  recordNote: $("recordNote"),
  appendicitisCapture: $("appendicitisCapture"),
  appendicitisEnabled: $("appendicitisEnabled"),
  continueCaseAfterArchive: $("continueCaseAfterArchive"),
  appendicitisDraftStatus: $("appendicitisDraftStatus"),
  appendicitisProgress: $("appendicitisProgress"),
  appendicitisForm: $("appendicitisForm"),
  recognizeButton: $("recognizeButton"),
  workspaceTitle: $("workspace-title"),
  ocrEngineSelect: $("ocrEngineSelect"),
  ocrStatus: $("ocrStatus"),
  ocrEmpty: $("ocrEmpty"),
  ocrEditor: $("ocrEditor"),
  detectedType: $("detectedType"),
  detectedReason: $("detectedReason"),
  applyDetectedTypeButton: $("applyDetectedTypeButton"),
  detectedPerson: $("detectedPerson"),
  detectedPersonReason: $("detectedPersonReason"),
  applyDetectedPersonButton: $("applyDetectedPersonButton"),
  qualitySummary: $("qualitySummary"),
  qualitySummaryTitle: $("qualitySummaryTitle"),
  qualitySummaryDetail: $("qualitySummaryDetail"),
  processingBar: $("processingBar"),
  processingTitle: $("processingTitle"),
  processingDetail: $("processingDetail"),
  processingPercent: $("processingPercent"),
  ocrText: $("ocrText"),
  summaryText: $("summaryText"),
  summaryMode: $("summaryMode"),
  summaryModeHint: $("summaryModeHint"),
  refreshSummaryButton: $("refreshSummaryButton"),
  copySummaryButton: $("copySummaryButton"),
  summaryMeta: $("summaryMeta"),
  summaryEditStatus: $("summaryEditStatus"),
  numberChips: $("numberChips"),
  metricTableWrap: $("metricTableWrap"),
  metricTableBody: $("metricTableBody"),
  reRecognizeButton: $("reRecognizeButton"),
  reviewConfirmed: $("reviewConfirmed"),
  archiveButton: $("archiveButton"),
  exportButton: $("exportButton"),
  importJsonButton: $("importJsonButton"),
  importJsonInput: $("importJsonInput"),
  exportJsonButton: $("exportJsonButton"),
  searchInput: $("searchInput"),
  filterSelect: $("filterSelect"),
  personFilterSelect: $("personFilterSelect"),
  recordTotal: $("recordTotal"),
  overviewStats: $("overviewStats"),
  overviewBody: $("overviewBody"),
  overviewEmpty: $("overviewEmpty"),
  copyOverviewButton: $("copyOverviewButton"),
  storageStatus: $("storageStatus"),
  recordList: $("recordList"),
  archiveEmpty: $("archiveEmpty"),
  toast: $("toast"),
  recordDialog: $("recordDialog"),
  dialogTitle: $("dialogTitle"),
  dialogBody: $("dialogBody"),
  closeDialogButton: $("closeDialogButton"),
  dialogDoneButton: $("dialogDoneButton"),
  deleteRecordButton: $("deleteRecordButton"),
};

const DB_NAME = "clinical-capture-local";
const STORE_NAME = "records";
const PADDLE_MODEL_ASSETS = {
  det: { url: new URL("./models/PP-OCRv6_small_det_onnx_infer.tar", document.baseURI).href },
  rec: { url: new URL("./models/PP-OCRv6_small_rec_onnx_infer.tar", document.baseURI).href },
};
const PADDLE_WASM_PATH = new URL("./vendor/onnxruntime/", document.baseURI).href;
const PADDLE_PREDICT_TIMEOUT_MS = 45000;
let database;

function makeId() {
  return `record-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(message, type = "success") {
  els.toast.textContent = message;
  els.toast.className = `toast show ${type === "error" ? "error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { els.toast.className = "toast"; }, 3100);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[char]));
}

const CAPTURE_DRAFT_KEY = "clinical-capture-draft-v2";
const HOSPITAL_CORRECTIONS_KEY = "clinical-hospital-corrections-v1";
const APPENDICITIS_MISSING_VALUES = new Set(["", "未填写", "未记录", "未描述", "未检查"]);

function getHospitalCorrections() {
  try {
    const value = JSON.parse(localStorage.getItem(HOSPITAL_CORRECTIONS_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function saveHospitalCorrections(corrections) {
  try { localStorage.setItem(HOSPITAL_CORRECTIONS_KEY, JSON.stringify(corrections.slice(-300))); } catch {}
}

function normalizeCorrectionKey(value) {
  return String(value || "").normalize("NFKC").replace(/[\s\u3000]/g, "").toUpperCase();
}

function findHospitalCorrection(rawAbbreviation, name = "", unit = "", recordType = "") {
  const rawKey = normalizeCorrectionKey(rawAbbreviation);
  const nameKey = normalizeCorrectionKey(name);
  const unitKey = normalizeCorrectionKey(unit);
  if (!rawKey) return "";
  const candidates = getHospitalCorrections().filter((item) => {
    if (normalizeCorrectionKey(item.raw) !== rawKey) return false;
    if (item.nameKey && nameKey && normalizeCorrectionKey(item.nameKey) !== nameKey) return false;
    if (item.unitKey && unitKey && normalizeCorrectionKey(item.unitKey) !== unitKey) return false;
    if (item.recordType && recordType && item.recordType !== recordType) return false;
    return true;
  });
  return candidates.sort((first, second) => Number(second.updatedAt || 0) - Number(first.updatedAt || 0))[0]?.canonical || "";
}

function rememberMetricCorrections(sourceRows = [], nextRows = [], recordType = "") {
  const corrections = getHospitalCorrections();
  let changed = false;
  nextRows.forEach((row, index) => {
    const source = sourceRows[index] || {};
    const raw = String(source.abbreviation || "").trim();
    const canonical = String(row.abbreviation || "").trim();
    if (!raw || !canonical || normalizeCorrectionKey(raw) === normalizeCorrectionKey(canonical)) return;
    const entry = {
      raw,
      canonical,
      nameKey: normalizeLabMetricName(row.name || source.name || ""),
      unitKey: normalizeLabUnit(row.unit || source.unit || ""),
      recordType,
      updatedAt: Date.now(),
    };
    const existing = corrections.find((item) => normalizeCorrectionKey(item.raw) === normalizeCorrectionKey(raw)
      && normalizeCorrectionKey(item.nameKey) === normalizeCorrectionKey(entry.nameKey)
      && normalizeCorrectionKey(item.unitKey) === normalizeCorrectionKey(entry.unitKey)
      && (item.recordType || "") === recordType);
    if (existing) Object.assign(existing, entry);
    else corrections.push(entry);
    changed = true;
  });
  if (changed) saveHospitalCorrections(corrections);
  return changed;
}

function renderAppendicitisForm() {
  if (!els.appendicitisForm) return;
  els.appendicitisForm.innerHTML = APPENDICITIS_FIELD_GROUPS.map((group) => {
    const renderField = (field) => {
      const control = field.type === "select"
        ? `<select data-appendicitis-field="${field.key}" data-default-value="${escapeHtml(field.defaultValue || "")}"><option value="">未填写</option>${field.options.map((option) => `<option value="${escapeHtml(option)}"${field.defaultValue === option ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`
        : field.type === "textarea"
          ? `<textarea data-appendicitis-field="${field.key}" rows="2" placeholder="${escapeHtml(field.placeholder || "")}"></textarea>`
          : `<input data-appendicitis-field="${field.key}" type="${field.type}"${field.step ? ` step="${field.step}"` : ""}${field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : ""} />`;
      return `<label class="field appendicitis-field"><span>${escapeHtml(field.label)}</span>${control}</label>`;
    };
    const fields = group.fields.filter((field) => !field.advanced).map(renderField).join("");
    const advancedFields = group.fields.filter((field) => field.advanced).map(renderField).join("");
    const advancedSection = advancedFields
      ? `<div class="appendicitis-advanced"><button class="button ghost appendicitis-advanced-toggle" type="button" data-toggle-appendicitis-advanced="${group.key}">展开复核/溯源信息</button><div class="appendicitis-advanced-panel" data-appendicitis-advanced-panel="${group.key}" hidden><div class="appendicitis-fields">${advancedFields}</div></div></div>`
      : "";
    return `<details class="appendicitis-group" data-appendicitis-group="${group.key}"${group.alwaysOpen ? " open" : ""}><summary><span>${escapeHtml(group.title)}</span><small data-group-count="${group.key}">0/${group.fields.length}</small></summary><p>${escapeHtml(group.hint)}</p><div class="appendicitis-fields">${fields}</div>${advancedSection}</details>`;
  }).join("");
  updateAppendicitisFormContext();
}

function getAppendicitisDataFromForm() {
  const data = {};
  els.appendicitisForm?.querySelectorAll("[data-appendicitis-field]").forEach((input) => {
    data[input.dataset.appendicitisField] = input.value.trim();
  });
  return data;
}

function applyAppendicitisData(data = {}) {
  const normalized = normalizeAppendicitisData(data);
  state.appendicitisData = { ...normalized };
  els.appendicitisForm?.querySelectorAll("[data-appendicitis-field]").forEach((input) => {
    const key = input.dataset.appendicitisField;
    input.value = Object.prototype.hasOwnProperty.call(normalized, key)
      ? (normalized[key] || "")
      : (input.dataset.defaultValue || "");
    if (key === "study_id" && /^CASE-[0-9A-F]{8}$/i.test(input.value)) input.dataset.autoGenerated = "true";
    else if (key === "study_id") delete input.dataset.autoGenerated;
  });
  els.appendicitisForm?.querySelectorAll("[data-appendicitis-advanced-panel]").forEach((panel) => {
    const group = APPENDICITIS_FIELD_GROUPS.find((candidate) => candidate.key === panel.dataset.appendicitisAdvancedPanel);
    const hasAdvancedValue = group?.fields.filter((field) => field.advanced).some((field) => isAppendicitisValueFilled(normalized[field.key]));
    panel.hidden = !hasAdvancedValue;
    const toggle = els.appendicitisForm.querySelector(`[data-toggle-appendicitis-advanced="${panel.dataset.appendicitisAdvancedPanel}"]`);
    if (toggle) toggle.textContent = hasAdvancedValue ? "收起复核/溯源信息" : "展开复核/溯源信息";
  });
  updateAppendicitisProgress();
}

function isAppendicitisValueFilled(value) {
  return !APPENDICITIS_MISSING_VALUES.has(String(value || "").trim());
}

function getSuggestedWsesGrade(data = {}) {
  const macroscopic = String(data.appendix_macroscopic_status || "").trim();
  const peritonealExtent = String(data.peritoneal_extent || "").trim();
  const abscessPresent = String(data.abscess_present || "").trim();
  const phlegmonPresent = String(data.phlegmon_present || "").trim();
  const necrosisLocation = String(data.necrosis_location || "").trim();
  const operativeAbscessSizeText = String(data.operative_abscess_size_cm || "").trim();
  const operativeAbscessSize = Number(operativeAbscessSizeText);

  if (peritonealExtent === "弥漫性" || macroscopic === "弥漫性腹膜炎") return "5";
  if (peritonealExtent === "局限性" || macroscopic === "局限性腹膜炎") return "4";
  if (abscessPresent === "有" || macroscopic === "脓肿") {
    if (isAppendicitisValueFilled(operativeAbscessSizeText) && Number.isFinite(operativeAbscessSize) && operativeAbscessSize > 4) return "3C";
    if (isAppendicitisValueFilled(operativeAbscessSizeText) && Number.isFinite(operativeAbscessSize) && operativeAbscessSize > 0 && operativeAbscessSize < 4) return "3B";
    return "";
  }
  if (phlegmonPresent === "有" || macroscopic === "蜂窝织炎/炎性包块") return "3A";
  if (necrosisLocation === "阑尾根部" || macroscopic === "根部坏死") return "2B";
  if (necrosisLocation === "节段性" || macroscopic === "节段性坏死") return "2A";
  if (macroscopic === "正常外观") return "0";
  if (macroscopic === "单纯炎症" || data.simpleInflammation === "有") return "1";
  return "";
}

function getAppendicitisFilledCount(data = getAppendicitisDataFromForm()) {
  return Object.values(data).filter(isAppendicitisValueFilled).length;
}

function updateAppendicitisProgress() {
  const data = getAppendicitisDataFromForm();
  state.appendicitisData = data;
  const suggestedGrade = getSuggestedWsesGrade(data);
  const suggestedGradeInput = els.appendicitisForm?.querySelector('[data-appendicitis-field="suggested_wses_grade"]');
  const machineBasisInput = els.appendicitisForm?.querySelector('[data-appendicitis-field="machine_grade_basis"]');
  const adjudicationStatusInput = els.appendicitisForm?.querySelector('[data-appendicitis-field="label_adjudication_status"]');
  const machineSuggestionStillEditable = suggestedGradeInput && !suggestedGradeInput.dataset.manuallyEdited
    && (!adjudicationStatusInput?.value || adjudicationStatusInput.value === "机器建议待确认");
  if (machineSuggestionStillEditable && suggestedGradeInput.value.trim() !== suggestedGrade) {
    suggestedGradeInput.value = suggestedGrade;
    data.suggested_wses_grade = suggestedGrade;
    state.appendicitisData = data;
  }
  if (machineSuggestionStillEditable && suggestedGrade && adjudicationStatusInput && !adjudicationStatusInput.value) {
    adjudicationStatusInput.value = "机器建议待确认";
    data.label_adjudication_status = "机器建议待确认";
    state.appendicitisData = data;
  }
  if (machineSuggestionStillEditable && !suggestedGrade && adjudicationStatusInput?.value === "机器建议待确认") {
    adjudicationStatusInput.value = "";
    data.label_adjudication_status = "";
    state.appendicitisData = data;
  }
  if (suggestedGrade && machineBasisInput && !machineBasisInput.value.trim()) {
    machineBasisInput.value = state.ocrEngine && state.ocrOriginalText ? "术中记录OCR" : "手工录入术中字段";
    data.machine_grade_basis = machineBasisInput.value;
    state.appendicitisData = data;
  }
  const total = APPENDICITIS_FIELD_DEFS.length;
  const filled = getAppendicitisFilledCount(data);
  if (els.appendicitisProgress) els.appendicitisProgress.textContent = `已填写 ${filled}/${total} 项；当前资料类型的重点字段已展开`;
  APPENDICITIS_FIELD_GROUPS.forEach((group) => {
    const groupFilled = group.fields.filter((field) => isAppendicitisValueFilled(data[field.key])).length;
    const counter = els.appendicitisForm?.querySelector(`[data-group-count="${group.key}"]`);
    if (counter) counter.textContent = `${groupFilled}/${group.fields.length}`;
  });
}

function updateAppendicitisFormContext() {
  const type = els.recordType?.value || "";
  APPENDICITIS_FIELD_GROUPS.forEach((group) => {
    const detail = els.appendicitisForm?.querySelector(`[data-appendicitis-group="${group.key}"]`);
    if (!detail) return;
    const relevant = Boolean(group.alwaysOpen || group.types?.includes(type));
    detail.classList.toggle("current-group", relevant);
    if (relevant) detail.open = true;
  });
}

function saveCaptureDraft() {
  try {
    localStorage.setItem(CAPTURE_DRAFT_KEY, JSON.stringify({
      savedAt: Date.now(),
      personName: els.personName?.value || "",
      personId: els.personId?.value || "",
      recordTitle: els.recordTitle?.value || "",
      recordType: els.recordType?.value || "",
      recordNote: els.recordNote?.value || "",
      appendicitisEnabled: Boolean(els.appendicitisEnabled?.checked),
      continueCaseAfterArchive: Boolean(els.continueCaseAfterArchive?.checked),
      appendicitisData: getAppendicitisDataFromForm(),
    }));
    if (els.appendicitisDraftStatus) els.appendicitisDraftStatus.textContent = "草稿已保存到本机";
  } catch {
    if (els.appendicitisDraftStatus) els.appendicitisDraftStatus.textContent = "草稿保存失败，请尽快归档或导出";
  }
}

let draftSaveTimer;
function scheduleCaptureDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveCaptureDraft, 180);
}

function restoreCaptureDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(CAPTURE_DRAFT_KEY) || "null");
    if (!draft) return;
    if (els.personName) els.personName.value = draft.personName || "";
    if (els.personId) els.personId.value = draft.personId || "";
    if (els.recordTitle) els.recordTitle.value = draft.recordTitle || "";
    if (els.recordType && draft.recordType) els.recordType.value = draft.recordType;
    if (els.recordNote) els.recordNote.value = draft.recordNote || "";
    if (els.appendicitisEnabled) els.appendicitisEnabled.checked = draft.appendicitisEnabled !== false;
    if (els.continueCaseAfterArchive) els.continueCaseAfterArchive.checked = draft.continueCaseAfterArchive !== false;
    if (els.appendicitisCapture) els.appendicitisCapture.hidden = !els.appendicitisEnabled.checked;
    applyAppendicitisData(draft.appendicitisData || {});
    syncAutoStudyId();
    updateAppendicitisFormContext();
    if (els.appendicitisDraftStatus) els.appendicitisDraftStatus.textContent = "已恢复上次未完成草稿";
    showToast("已恢复上次未完成的病例采集草稿");
  } catch {
    localStorage.removeItem(CAPTURE_DRAFT_KEY);
  }
}

function clearCaptureDraft() {
  clearTimeout(draftSaveTimer);
  try { localStorage.removeItem(CAPTURE_DRAFT_KEY); } catch {}
}

function setAppendicitisAutoValue(key, value) {
  if (!isAppendicitisValueFilled(value)) return false;
  const input = els.appendicitisForm?.querySelector(`[data-appendicitis-field="${key}"]`);
  if (!input || input.value.trim()) return false;
  input.value = String(value);
  return true;
}

function syncAutoStudyId() {
  if (els.appendicitisEnabled?.checked === false) return false;
  const input = els.appendicitisForm?.querySelector('[data-appendicitis-field="study_id"]');
  if (!input) return false;
  const personId = els.personId?.value.trim() || "";
  const personName = els.personName?.value.trim() || "";
  const identity = personId ? `id:${normalizeIdentityToken(personId)}` : personName ? `name:${normalizeIdentityToken(personName)}` : "";
  if (!identity || (input.value.trim() && input.dataset.autoGenerated !== "true")) return false;
  const next = `CASE-${getStableResearchHash(identity)}`;
  if (input.value.trim() === next) return false;
  input.value = next;
  input.dataset.autoGenerated = "true";
  return true;
}

function getMetricByAbbreviations(rows, abbreviations = [], names = []) {
  return rows.find((row) => abbreviations.includes(String(row.abbreviation || "").toUpperCase()) || names.some((name) => String(row.name || "").includes(name)));
}

function extractFindingState(text, terms) {
  const source = String(text || "").replace(/\s+/g, "");
  const termPattern = terms.map(escapeRegExp).join("|");
  const match = source.match(new RegExp(`(.{0,12})(?:${termPattern})(.{0,12})`, "i"));
  if (!match) return "";
  const context = `${match[1]}${match[2]}`;
  if (/(未见|未发现|未提示|否认|无明显|未见明显)/.test(match[1])) return "无";
  if (/(考虑|可能|可疑|提示)/.test(context)) return "不确定";
  return "有";
}

function extractStructuredAppendicitisValue(text, rules = []) {
  const source = String(text || "").replace(/\s+/g, "");
  for (const [pattern, value] of rules) {
    if (pattern.test(source)) return value;
  }
  return "";
}

function applyAutoAppendicitisFields(text, type) {
  if (!els.appendicitisEnabled?.checked || !text.trim()) return;
  let changed = false;
  const compact = String(text).replace(/\s+/g, "");
  const age = compact.match(/年龄[:：]?([0-9]+(?:\.[0-9]+)?)岁?/i)?.[1];
  const temperature = compact.match(/(?:体温|腋温|口温|肛温)[:：]?([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  const painHours = compact.match(/腹痛.{0,15}?([0-9]+(?:\.[0-9]+)?)\s*(?:小时|h)/i)?.[1];
  const diameter = compact.match(/阑尾.{0,10}?(?:最大径|直径|内径)[:：]?([0-9]+(?:\.[0-9]+)?)\s*(?:mm|毫米)/i)?.[1];
  const sex = compact.match(/性别[:：]?(男|女)/)?.[1];
  const bmi = compact.match(/BMI[:：]?([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  const heightCm = compact.match(/身高[:：]?([0-9]+(?:\.[0-9]+)?)\s*(?:cm|厘米)/i)?.[1];
  const weightKg = compact.match(/体重[:：]?([0-9]+(?:\.[0-9]+)?)\s*(?:kg|千克)/i)?.[1];
  const heartRate = compact.match(/(?:心率|脉搏)[:：]?([0-9]{2,3})/i)?.[1];
  const bloodPressure = compact.match(/(?:血压|BP)[:：]?([0-9]{2,3})\s*[/／]\s*([0-9]{2,3})/i);
  const respiratoryRate = compact.match(/(?:呼吸频率|呼吸|RR)[:：]?([0-9]{1,2})/i)?.[1];
  const spo2 = compact.match(/(?:血氧饱和度|血氧|SpO2)[:：]?([0-9]{2,3}(?:\.[0-9]+)?)\s*%?/i)?.[1];
  changed = setAppendicitisAutoValue("age", age) || changed;
  changed = setAppendicitisAutoValue("admissionTempC", temperature) || changed;
  changed = setAppendicitisAutoValue("painDurationHours", painHours) || changed;
  changed = setAppendicitisAutoValue("appendixDiameterMm", diameter) || changed;
  changed = setAppendicitisAutoValue("sex", sex) || changed;
  changed = setAppendicitisAutoValue("bmi", bmi) || changed;
  changed = setAppendicitisAutoValue("heightCm", heightCm) || changed;
  changed = setAppendicitisAutoValue("weightKg", weightKg) || changed;
  const heightValue = Number(els.appendicitisForm?.querySelector('[data-appendicitis-field="heightCm"]')?.value || heightCm);
  const weightValue = Number(els.appendicitisForm?.querySelector('[data-appendicitis-field="weightKg"]')?.value || weightKg);
  if (!bmi && heightValue > 0 && weightValue > 0) {
    changed = setAppendicitisAutoValue("bmi", (weightValue / ((heightValue / 100) ** 2)).toFixed(1)) || changed;
  }
  changed = setAppendicitisAutoValue("heart_rate", heartRate) || changed;
  changed = setAppendicitisAutoValue("systolic_bp", bloodPressure?.[1]) || changed;
  changed = setAppendicitisAutoValue("diastolic_bp", bloodPressure?.[2]) || changed;
  changed = setAppendicitisAutoValue("respiratory_rate", respiratoryRate) || changed;
  changed = setAppendicitisAutoValue("spo2", spo2) || changed;
  if (compact.includes("抗生素前")) changed = setAppendicitisAutoValue("preop_timepoint", "入院后、手术前、抗生素前") || changed;
  if (compact.includes("抗生素后")) changed = setAppendicitisAutoValue("preop_timepoint", "入院后、手术前、抗生素后") || changed;
  if (compact.includes("抗生素前")) changed = setAppendicitisAutoValue("preop_antibiotic_status", "抗生素前") || changed;
  if (compact.includes("抗生素后")) changed = setAppendicitisAutoValue("preop_antibiotic_status", "抗生素后") || changed;
  if (labFieldRules[type]) changed = setAppendicitisAutoValue("lab_collection_status", "已采集") || changed;
  if (["CT", "彩超"].includes(type)) {
    changed = setAppendicitisAutoValue("imagingMethod", type) || changed;
    changed = setAppendicitisAutoValue("imaging_status", "已检查") || changed;
  }

  const rows = labFieldRules[type] ? extractAllLabRows(text, state.ocrBlocks) : [];
  const metricMappings = [
    ["lymphPct", ["LYMPH%"], ["淋巴细胞百分比"]], ["fibrinogen", ["FIB"], ["纤维蛋白原"]],
    ["wbc", ["WBC"], ["白细胞"]], ["neutAbs", ["NEUT#"], ["中性粒细胞绝对数"]],
    ["neutPct", ["NEUT%"], ["中性粒细胞百分比"]], ["lymphAbs", ["LYMPH#"], ["淋巴细胞绝对数"]],
    ["monocyteAbs", ["MONO#"], ["单核细胞绝对数"]], ["monocytePct", ["MONO%"], ["单核细胞百分比"]],
    ["hgb", ["HGB", "HB"], ["血红蛋白"]],
    ["plt", ["PLT"], ["血小板计数"]], ["crp", ["CRP"], ["C反应蛋白"]],
    ["pct", [], ["降钙素原", "降钙素"]], ["creatinine", ["CREA", "CR"], ["肌酐"]],
    ["egfr", ["EGFR"], ["估算肾小球滤过率", "肾小球滤过率"]], ["urea", ["UREA", "BUN"], ["尿素"]],
    ["albumin", ["ALB"], ["白蛋白"]], ["totalBilirubin", ["TBIL"], ["总胆红素"]],
    ["glucose", ["GLU"], ["葡萄糖", "血糖"]], ["lactate", ["LAC", "LACTATE"], ["乳酸"]],
    ["ast", ["AST"], ["天门冬氨酸氨基转移酶", "谷草转氨酶"]], ["alt", ["ALT"], ["丙氨酸氨基转移酶", "谷丙转氨酶"]],
    ["sodium", ["NA", "NAT"], ["钠"]], ["potassium", ["K"], ["钾"]],
    ["chloride", ["CL"], ["氯"]], ["calcium", ["CA"], ["钙"]],
  ];
  metricMappings.forEach(([key, abbreviations, names]) => {
    const metric = getMetricByAbbreviations(rows, abbreviations, names);
    if (metric) changed = setAppendicitisAutoValue(key, metric.value) || changed;
  });

  const findingMappings = [
    ...(type === "门诊病历" || type === "住院病历" || type === "出院小结" ? [
      ["right_lower_quadrant_pain", ["右下腹痛", "右下腹疼痛"]], ["migratoryPain", ["转移性腹痛", "疼痛转移"]],
      ["nausea_vomiting", ["恶心", "呕吐"]], ["appetite_loss", ["食欲下降", "纳差"]],
      ["diarrhea", ["腹泻"]], ["fever_chills", ["发热", "寒战"]],
      ["right_lower_quadrant_tenderness", ["右下腹压痛"]], ["rebound_pain", ["反跳痛"]],
      ["guarding", ["肌紧张"]], ["localized_peritoneal_irritation", ["局限性腹膜刺激征", "局限性腹膜炎"]],
      ["diffuse_peritoneal_irritation", ["弥漫性腹膜刺激征", "弥漫性腹膜炎"]],
      ["antibiotics_before_admission", ["入院前使用抗生素", "入院前应用抗生素"]],
      ["analgesics_before_admission", ["入院前使用止痛药", "入院前应用止痛药"]],
    ] : []),
    ...(type === "CT" || type === "彩超" ? [
      ["imagingAppendicolith", ["粪石", "阑尾结石"]], ["fatStranding", ["脂肪浸润", "脂肪间隙浑浊"]],
      ["periAppendicealFluid", ["阑尾周围积液", "周围积液"]], ["imagingAbscess", ["脓肿", "脓腔"]],
      ["imagingPhlegmon", ["炎性包块", "包块"]], ["freeGas", ["游离气体", "游离气"]],
      ["appendix_wall_discontinuity", ["阑尾壁中断", "阑尾壁缺损", "阑尾壁不连续"]],
      ["free_fluid", ["游离液体", "腹腔积液"]],
      ["imagingPerforation", ["穿孔", "破裂", "壁缺损"]],
    ] : []),
    ...(type === "手术记录" ? [
      ["operativeAppendicolith", ["粪石", "阑尾结石"]], ["operativePurulentExudate", ["脓液", "脓性渗出", "脓性分泌物", "脓性液体", "脓性渗出液"]],
      ["abscess_present", ["脓肿", "脓腔"]], ["phlegmon_present", ["炎性包块", "包块"]],
      ["perforation_primary", ["穿孔", "破裂", "破口", "壁缺损"]], ["drainagePlaced", ["腹腔引流", "放置引流", "引流管"]],
      ["necrosis_present", ["坏死", "坏疽"]], ["free_appendicolith", ["游离粪石"]],
      ["laparoscopy_exploration", ["腹腔镜探查", "腹腔镜手术"]], ["laparoscopy_completed", ["完成腹腔镜", "腹腔镜下完成"]],
      ["appendectomy_attempted", ["阑尾切除", "切除阑尾", "阑尾切除术"]], ["conversion_to_open", ["中转开腹", "转开腹"]],
    ] : []),
    ...(type === "病理报告" ? [
      ["pathologyPerforation", ["穿孔", "破裂", "壁缺损"]], ["pathologyAppendicolith", ["粪石", "阑尾结石"]],
      ["pathology_acute_appendicitis_confirmed", ["急性阑尾炎"]],
    ] : []),
  ];
  findingMappings.forEach(([key, terms]) => {
    const stateValue = extractFindingState(text, terms);
    const normalizedStateValue = key === "perforation_primary" ? ({ 有: "是", 无: "否" }[stateValue] || stateValue) : stateValue;
    if (normalizedStateValue) changed = setAppendicitisAutoValue(key, normalizedStateValue) || changed;
  });
  const abscessSizeCm = compact.match(/(?:脓肿|脓腔).{0,25}?(?:最大径|直径|大小|约)[:：]?([0-9]+(?:\.[0-9]+)?)\s*(?:cm|厘米)/i)?.[1];
  if (type === "CT" || type === "彩超") {
    changed = setAppendicitisAutoValue("imaging_abscess_size_cm", abscessSizeCm) || changed;
    const imagingPerforationLocation = compact.match(/阑尾(?:的)?(尖端|头端|体部|根部|基底部|远端).{0,8}(?:穿孔|破口|破裂|壁缺损)/i)?.[1]
      || compact.match(/(?:穿孔|破口|破裂|壁缺损).{0,8}(?:位于|在|于)?阑尾(?:的)?(尖端|头端|体部|根部|基底部|远端)/i)?.[1];
    if (imagingPerforationLocation) changed = setAppendicitisAutoValue("imaging_perforation_location", `阑尾${imagingPerforationLocation}`) || changed;
  }
  if (type === "手术记录") {
    changed = setAppendicitisAutoValue("operative_abscess_size_cm", abscessSizeCm) || changed;
  }
  const explicitGrade = compact.match(/WSES(?:分级|GRADE)?[:：]?((?:3C|3B|3A|2B|2A|[0-5]))/i)?.[1]?.toUpperCase();
  changed = setAppendicitisAutoValue("final_wses_grade", explicitGrade) || changed;
  if (type === "手术记录") {
    changed = setAppendicitisAutoValue("operative_report_available", "有") || changed;
    changed = setAppendicitisAutoValue("grade_source", "手术记录") || changed;
    changed = setAppendicitisAutoValue("machine_grade_basis", "术中记录OCR") || changed;
    const perforationLocation = compact.match(/阑尾(?:的)?(尖端|头端|体部|根部|基底部|远端).{0,8}(?:穿孔|破口|破裂)/i)?.[1]
      || compact.match(/(?:穿孔|破口|破裂).{0,8}(?:位于|在|于)?阑尾(?:的)?(尖端|头端|体部|根部|基底部|远端)/i)?.[1];
    if (perforationLocation) changed = setAppendicitisAutoValue("perforation_location", `阑尾${perforationLocation}`) || changed;
    const operativeRules = [
      ["appendix_macroscopic_status", [[/阑尾.{0,8}(?:正常外观|外观正常)/i, "正常外观"], [/节段性坏死/i, "节段性坏死"], [/根部坏死/i, "根部坏死"], [/(?:蜂窝织炎|炎性包块)/i, "蜂窝织炎/炎性包块"], [/脓肿|脓腔/i, "脓肿"], [/局限性腹膜炎/i, "局限性腹膜炎"], [/弥漫性腹膜炎/i, "弥漫性腹膜炎"], [/化脓性阑尾炎|化脓性炎症/i, "化脓性炎症"], [/单纯炎症|单纯性炎症/i, "单纯炎症"]]],
      ["necrosis_location", [[/根部坏死/i, "阑尾根部"], [/节段性坏死/i, "节段性"], [/坏死/i, "其他"]]],
      ["peritoneal_extent", [[/弥漫性腹膜炎|全腹膜炎|弥漫性污染/i, "弥漫性"], [/局限性腹膜炎|局部腹膜炎|右下腹腹膜炎/i, "局限性"]]],
      ["contamination_type", [[/粪性污染|粪汁|粪便污染/i, "粪性"], [/混合污染/i, "混合"], [/脓性污染|脓液污染|脓性渗出|脓性液体|脓性分泌物/i, "脓性"]]],
      ["perforation_type", [[/游离性穿孔|自由穿孔|游离穿孔/i, "游离性"], [/包裹性穿孔|局限性穿孔|局限.*穿孔/i, "局限/包裹性"]]],
    ];
    operativeRules.forEach(([key, rules]) => {
      const value = extractStructuredAppendicitisValue(text, rules);
      if (value) changed = setAppendicitisAutoValue(key, value) || changed;
    });
  }
  if (changed) {
    updateAppendicitisProgress();
    scheduleCaptureDraftSave();
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { resolve(null); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => { database = request.result; resolve(database); };
    request.onerror = () => reject(request.error);
  });
}

function getLocalFallback() {
  try { return JSON.parse(localStorage.getItem(DB_NAME) || "[]"); } catch { return []; }
}

function normalizeAppendicitisData(data = {}) {
  const normalized = data && typeof data === "object" ? { ...data } : {};
  const aliases = {
    study_id: ["studyId"],
    admission_datetime: ["admissionTime", "admissionDate"],
    right_lower_quadrant_tenderness: ["rlqTenderness"],
    perforation_location: ["perforationLocation"],
    perforation_primary: ["perforation_present", "operativePerforation"],
    abscess_present: ["operativeAbscess"],
    phlegmon_present: ["operativePhlegmon"],
    peritoneal_extent: ["operativePeritonitis"],
    imaging_abscess_size_cm: ["imagingAbscessSizeCm", "abscessSizeCm"],
    pathology_acute_appendicitis_confirmed: ["pathologyAcuteAppendicitisConfirmed"],
    postoperative_antibiotic_duration_days: ["antibioticDurationDays"],
    discharge_date: ["dischargeDate"],
  };
  Object.entries(aliases).forEach(([canonical, legacyKeys]) => {
    if (isAppendicitisValueFilled(normalized[canonical])) return;
    const legacyValue = legacyKeys.map((key) => normalized[key]).find(isAppendicitisValueFilled);
    if (isAppendicitisValueFilled(legacyValue)) normalized[canonical] = legacyValue;
  });
  if (isAppendicitisValueFilled(normalized.suggested_wses_grade) && !isAppendicitisValueFilled(normalized.machine_grade_algorithm_version)) normalized.machine_grade_algorithm_version = "WSES-rule-v1";
  return normalized;
}

function normalizeRecord(record) {
  return {
    ...record,
    personName: record.personName || "",
    personId: record.personId || "",
    patientKey: record.patientKey || "",
    summary: record.summary || "",
    ocrEdited: Boolean(record.ocrEdited),
    ocrOriginalText: record.ocrOriginalText || record.text || "",
    studyIdOrigin: record.studyIdOrigin || "",
    batchAudit: record.batchAudit && typeof record.batchAudit === "object" ? record.batchAudit : null,
    metrics: Array.isArray(record.metrics) ? record.metrics.map((metric) => ({
      ...metric,
      rawName: metric.rawName || metric.name || "",
      rawAbbreviation: metric.rawAbbreviation || metric.abbreviation || "",
      rawValue: metric.rawValue || metric.value || "",
      rawReference: metric.rawReference || metric.reference || "",
      rawUnit: metric.rawUnit || metric.unit || "",
      rawFlag: metric.rawFlag || metric.flag || "",
      sourcePage: metric.sourcePage || "",
      sourceBox: metric.sourceBox || "",
      sourceText: metric.sourceText || "",
    })) : [],
    numbers: Array.isArray(record.numbers) ? record.numbers : [],
    images: Array.isArray(record.images) ? record.images.filter((image) => typeof image === "string" && image.startsWith("data:image/")) : [],
    createdAt: Number.isFinite(Number(record.createdAt)) ? Number(record.createdAt) : Date.now(),
    reviewConfirmed: Boolean(record.reviewConfirmed || record.reviewStatus === "人工已复核"),
    reviewStatus: record.reviewStatus || (record.reviewConfirmed ? "人工已复核" : "待人工复核"),
    appendicitisData: normalizeAppendicitisData(record.appendicitisData),
  };
}

async function loadRecords() {
  try {
    if (!database) await openDatabase();
    if (!database) { state.records = getLocalFallback().map(normalizeRecord); renderRecords(); updateStorageStatus(); return; }
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => { state.records = request.result.map(normalizeRecord).sort((a, b) => b.createdAt - a.createdAt); renderRecords(); updateStorageStatus(); };
    request.onerror = () => { state.records = getLocalFallback().map(normalizeRecord); renderRecords(); updateStorageStatus(); };
  } catch {
    state.records = getLocalFallback().map(normalizeRecord);
    renderRecords();
    updateStorageStatus();
  }
}

async function saveRecord(record) {
  if (!database) await openDatabase();
  if (!database) {
    const records = getLocalFallback().filter((item) => item.id !== record.id);
    records.push(record);
    localStorage.setItem(DB_NAME, JSON.stringify(records));
    return;
  }
  await new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(record);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}

async function removeRecord(id) {
  if (!database) await openDatabase();
  if (!database) {
    localStorage.setItem(DB_NAME, JSON.stringify(getLocalFallback().filter((item) => item.id !== id)));
    return;
  }
  await new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}

function renderPreviews() {
  els.captureCount.textContent = state.imagesLoading ? `${state.images.length} 张 · 正在读取` : `${state.images.length} 张`;
  els.previewStrip.innerHTML = state.images.map((image, index) => `
    <div class="preview-item">
      <img src="${image.dataUrl}" alt="待识别图片 ${index + 1}" />
      <button class="remove-preview" type="button" data-index="${index}" aria-label="移除图片">×</button>
    </div>
  `).join("");
  els.recognizeButton.disabled = state.images.length === 0 || state.ocrBusy || state.imagesLoading;
}

function renderNumbers(text) {
  const numbers = text.match(/[-+]?\d+(?:[.,]\d+)?(?:\s?(?:mg|g|mmol\/L|μmol\/L|mmHg|℃|%|次\/分|mL|片|粒|天|岁))?/gi) || [];
  const unique = [...new Set(numbers.map((item) => item.trim()))].slice(0, 30);
  els.numberChips.innerHTML = unique.length
    ? unique.map((number) => `<span class="number-chip">${escapeHtml(number)}</span>`).join("")
    : `<span class="muted-chip">暂无数字</span>`;
}

function setOcrStatus(label, active = false) {
  els.ocrStatus.innerHTML = `<span class="status-dot ${active ? "" : "neutral"}"></span>${label}`;
}

function setOcrEditor(visible) {
  els.ocrEmpty.hidden = visible;
  els.ocrEditor.hidden = !visible;
}

const documentTypeRules = [
  { type: "血常规", terms: ["血常规", "白细胞", "红细胞", "血红蛋白", "血小板", "WBC", "RBC", "HGB", "PLT", "NEUT", "LYM"] },
  { type: "肝肾功能", terms: ["肝功能", "肾功能", "谷丙转氨酶", "谷草转氨酶", "肌酐", "尿素", "尿酸", "ALT", "AST", "TBIL", "CREA", "BUN", "UA", "eGFR"] },
  { type: "止凝血", terms: ["凝血", "止凝血", "凝血酶原时间", "活化部分凝血活酶时间", "纤维蛋白原", "D-二聚体", "D二聚体", "INR", "PT", "APTT", "FIB", "TT"] },
  { type: "CT", terms: ["CT", "计算机断层", "断层扫描", "增强扫描", "CT平扫", "CT增强"] },
  { type: "彩超", terms: ["彩超", "彩色多普勒", "彩色多普勒超声", "超声诊断报告", "超声", "B超", "超声检查", "ULTRASOUND"] },
  { type: "手术记录", terms: ["手术记录", "手术名称", "术中所见", "术中诊断", "术式", "腹腔镜探查", "切除阑尾", "腹腔镜阑尾切除"] },
  { type: "门诊病历", terms: ["门诊病历", "门诊记录", "门诊号", "主诉", "现病史", "体格检查"] },
  { type: "住院病历", terms: ["住院病历", "入院记录", "住院号", "入院诊断", "病程记录", "查房记录"] },
  { type: "出院小结", terms: ["出院小结", "出院记录", "出院诊断", "出院医嘱", "入院日期", "出院日期"] },
  { type: "处方/用药", terms: ["处方", "药品名称", "用法用量", "规格", "每次", "每日", "医嘱"] },
  { type: "病理报告", terms: ["病理报告", "病理诊断", "组织学", "免疫组化", "镜下所见", "病理号"] },
  { type: "心电图", terms: ["心电图", "心电", "窦性心律", "心率", "P波", "QRS", "ST段"] },
];

const labFieldRules = {
  血常规: [
    ["白细胞", ["白细胞", "WBC"]], ["红细胞", ["红细胞", "RBC"]], ["血红蛋白", ["血红蛋白", "HGB", "HB"]], ["血小板", ["血小板", "PLT"]],
    ["中性粒细胞", ["中性粒细胞", "NEUT"]], ["淋巴细胞", ["淋巴细胞", "LYM"]], ["单核细胞", ["单核细胞", "MONO"]], ["嗜酸性粒细胞", ["嗜酸性粒细胞", "EOS"]],
  ],
  肝肾功能: [
    ["谷丙转氨酶", ["谷丙转氨酶", "ALT"]], ["谷草转氨酶", ["谷草转氨酶", "AST"]], ["总胆红素", ["总胆红素", "TBIL"]], ["白蛋白", ["白蛋白", "ALB"]],
    ["总蛋白", ["总蛋白", "TP"]], ["肌酐", ["肌酐", "CREA", "Cr"]], ["尿素", ["尿素", "BUN"]], ["尿酸", ["尿酸", "UA"]], ["估算肾小球滤过率", ["eGFR", "肾小球滤过率"]],
  ],
  止凝血: [
    ["凝血酶原时间", ["凝血酶原时间", "PT"]], ["国际标准化比值", ["国际标准化比值", "INR"]], ["活化部分凝血活酶时间", ["活化部分凝血活酶时间", "APTT"]],
    ["纤维蛋白原", ["纤维蛋白原", "FIB"]], ["凝血酶时间", ["凝血酶时间", "TT"]], ["D-二聚体", ["D-二聚体", "D二聚体", "D-DIMER"]],
  ],
};

const APPENDICITIS_VALUE_OPTIONS = ["有", "无", "未检查", "未记录", "未描述", "不确定"];
const PREOP_TIMEPOINT_OPTIONS = ["入院后、手术前、抗生素前", "入院后、手术前、抗生素后", "手术前但具体时间不明", "不适用", "未记录"];
const WSES_GRADE_OPTIONS = ["0", "1", "2A", "2B", "3A", "3B", "3C", "4", "5", "未判定"];
const APPENDICITIS_FIELD_GROUPS = [
  {
    key: "basic",
    title: "病例基础",
    hint: "建立病例时填写；OCR可辅助识别年龄和性别",
    alwaysOpen: true,
    fields: [
      { key: "study_id", label: "研究编号（study_id，自动生成）", type: "text", placeholder: "识别到个人编号后自动生成；也可手动修改" },
      { key: "hospital_center", label: "医院/中心", type: "text", defaultValue: "安徽医科大学第一附属医院高新院区", placeholder: "可按实际情况修改" },
      { key: "admission_datetime", label: "入院日期时间", type: "datetime-local" },
      { key: "age", label: "年龄（岁）", type: "number", step: "0.1" },
      { key: "sex", label: "性别", type: "select", options: ["男", "女", "其他/不详"] },
      { key: "heightCm", label: "身高（cm）", type: "number", step: "0.1" },
      { key: "weightKg", label: "体重（kg）", type: "number", step: "0.1" },
      { key: "first_acute_appendicitis_episode", label: "首次急性阑尾炎发作", type: "select", options: ["是", "否", "不确定", "未记录"] },
      { key: "index_episode", label: "是否为纳入的 index episode（默认是）", type: "select", options: ["是", "否", "重复住院/重复发作", "不确定", "未记录"], defaultValue: "是" },
      { key: "exclusion_reason", label: "排除原因", type: "textarea", placeholder: "仅在不纳入或重复 episode 时填写具体原因" },
    ],
  },
  {
    key: "symptoms",
    title: "病程与入院体征",
    hint: "拍入院病历或询问病例时同步填写",
    types: ["住院病历", "门诊病历", "出院小结"],
    fields: [
      { key: "symptom_onset_datetime", label: "症状开始时间", type: "datetime-local" },
      { key: "painDurationHours", label: "腹痛持续时间（小时）", type: "number", step: "0.1" },
      { key: "right_lower_quadrant_pain", label: "右下腹痛", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "migratoryPain", label: "转移性右下腹痛", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "nausea_vomiting", label: "恶心/呕吐", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "appetite_loss", label: "食欲下降", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "diarrhea", label: "腹泻", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "fever_chills", label: "发热/寒战", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "right_lower_quadrant_tenderness", label: "右下腹压痛", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "rebound_pain", label: "反跳痛", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "guarding", label: "肌紧张", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "localized_peritoneal_irritation", label: "局限性腹膜刺激征", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "diffuse_peritoneal_irritation", label: "弥漫性腹膜刺激征", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "reboundGuarding", label: "反跳痛或肌紧张（合并记录）", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "admissionTempC", label: "入院体温（℃）", type: "number", step: "0.1" },
      { key: "clinicalPeritonitis", label: "明确腹膜炎", type: "select", options: ["无", "局限性", "弥漫性", "未描述", "不确定"] },
    ],
  },
  {
    key: "preoperative",
    title: "术前预测变量（时间点）",
    hint: "仅把入院后、手术前资料放入预测变量；必须注明抗生素前/后，不能把术中或术后信息混入。",
    types: ["血常规", "肝肾功能", "止凝血", "CT", "彩超", "门诊病历", "住院病历"],
    fields: [
      { key: "preop_timepoint", label: "术前数据时间点", type: "select", options: PREOP_TIMEPOINT_OPTIONS },
      { key: "preop_assessment_time", label: "术前评估时间", type: "datetime-local" },
      { key: "preop_antibiotic_status", label: "抗生素时间关系", type: "select", options: ["抗生素前", "抗生素后", "不明/未记录"] },
      { key: "bmi", label: "BMI", type: "number", step: "0.1" },
      { key: "heart_rate", label: "心率（次/分）", type: "number", step: "1" },
      { key: "systolic_bp", label: "收缩压（mmHg）", type: "number", step: "1" },
      { key: "diastolic_bp", label: "舒张压（mmHg）", type: "number", step: "1" },
      { key: "respiratory_rate", label: "呼吸频率（次/分）", type: "number", step: "1" },
      { key: "spo2", label: "血氧饱和度（%）", type: "number", step: "0.1" },
      { key: "antibiotics_before_admission", label: "入院前使用抗生素", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "analgesics_before_admission", label: "入院前使用止痛药", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
    ],
  },
  {
    key: "perforationCore",
    title: "穿孔判定（核心）",
    hint: "本区记录穿孔相关证据，不作为队列纳入门槛；术中主要结局请填写下方“术中明确穿孔（perforation_primary）”。",
    alwaysOpen: true,
    fields: [
      { key: "perforationStatus", label: "穿孔相关综合判断（非纳入门槛）", type: "select", options: ["明确穿孔", "疑似穿孔", "未见穿孔", "待判定"] },
      { key: "perforation_location", label: "穿孔部位/范围", type: "text", placeholder: "如：阑尾尖端、体部、根部；未描述可留空" },
      { key: "perforationBasis", label: "穿孔相关依据摘要（可选）", type: "textarea", placeholder: "如：术中见阑尾体部穿孔伴脓液；CT示阑尾壁缺损" },
    ],
  },
  {
    key: "labs",
    title: "首次化验",
    hint: "OCR自动填入；手工改动会保留，优先填写首次抗生素前结果。未检查与未记录分开填写，NLR/PLR/SIRI/PNI等衍生指标后期由原始值统一计算。",
    types: ["血常规", "肝肾功能", "止凝血"],
    fields: [
      { key: "lab_timepoint", label: "化验时间点", type: "select", options: PREOP_TIMEPOINT_OPTIONS },
      { key: "lab_collection_time", label: "化验采集时间", type: "datetime-local" },
      { key: "lab_collection_status", label: "化验资料状态", type: "select", options: ["已采集", "未检查", "未记录", "不确定"] },
      { key: "lymphPct", label: "LYMPH%（%）", type: "number", step: "0.1" },
      { key: "fibrinogen", label: "FIB（g/L）", type: "number", step: "0.01" },
      { key: "wbc", label: "WBC（×10⁹/L）", type: "number", step: "0.01" },
      { key: "neutAbs", label: "NEUT#（×10⁹/L）", type: "number", step: "0.01" },
      { key: "neutPct", label: "NEUT%（%）", type: "number", step: "0.1" },
      { key: "lymphAbs", label: "LYMPH#（×10⁹/L）", type: "number", step: "0.01" },
      { key: "monocyteAbs", label: "MONO#（×10⁹/L）", type: "number", step: "0.01" },
      { key: "monocytePct", label: "MONO%（%）", type: "number", step: "0.1" },
      { key: "hgb", label: "HGB（g/L）", type: "number", step: "0.1" },
      { key: "plt", label: "PLT（×10⁹/L）", type: "number", step: "1" },
      { key: "crp", label: "CRP（mg/L）", type: "number", step: "0.1" },
      { key: "pct", label: "PCT/降钙素原（ng/mL）", type: "number", step: "0.01" },
      { key: "creatinine", label: "肌酐 Cr（μmol/L）", type: "number", step: "0.1" },
      { key: "egfr", label: "eGFR（mL/min/1.73m²）", type: "number", step: "0.1" },
      { key: "urea", label: "尿素 UREA/BUN（mmol/L）", type: "number", step: "0.1" },
      { key: "albumin", label: "白蛋白 ALB（g/L）", type: "number", step: "0.1" },
      { key: "totalBilirubin", label: "总胆红素 TBIL（μmol/L）", type: "number", step: "0.1" },
      { key: "glucose", label: "血糖 GLU（mmol/L）", type: "number", step: "0.1" },
      { key: "lactate", label: "乳酸（mmol/L）", type: "number", step: "0.01" },
      { key: "ast", label: "AST（U/L）", type: "number", step: "0.1" },
      { key: "alt", label: "ALT（U/L）", type: "number", step: "0.1" },
      { key: "sodium", label: "钠 Na（mmol/L）", type: "number", step: "0.1" },
      { key: "potassium", label: "钾 K（mmol/L）", type: "number", step: "0.1" },
      { key: "chloride", label: "氯 Cl（mmol/L）", type: "number", step: "0.1" },
      { key: "calcium", label: "钙 Ca（mmol/L）", type: "number", step: "0.01" },
    ],
  },
  {
    key: "imaging",
    title: "CT/彩超关键所见",
    hint: "以报告原文为依据；未提到不能直接当作“无”",
    types: ["CT", "彩超"],
    fields: [
      { key: "imaging_timepoint", label: "影像检查时间点", type: "select", options: PREOP_TIMEPOINT_OPTIONS },
      { key: "imaging_exam_time", label: "影像检查时间", type: "datetime-local" },
      { key: "imaging_status", label: "影像资料状态", type: "select", options: ["已检查", "未检查", "未记录", "不确定"] },
      { key: "imaging_abscess_size_cm", label: "影像脓肿最大径（cm）", type: "number", step: "0.1" },
      { key: "imagingMethod", label: "影像方式", type: "select", options: ["CT", "彩超", "MRI", "CT+彩超", "无", "未检查", "未记录", "未描述"] },
      { key: "appendixDiameterMm", label: "阑尾最大直径（mm）", type: "number", step: "0.1" },
      { key: "imagingAppendicolith", label: "影像粪石", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "appendicolithSizeMm", label: "粪石最大径（mm）", type: "number", step: "0.1" },
      { key: "appendix_wall_discontinuity", label: "阑尾壁中断/缺损", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "fatStranding", label: "周围脂肪浸润", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "periAppendicealFluid", label: "阑尾周围积液", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "free_fluid", label: "腹腔游离液体", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "imagingAbscess", label: "影像脓肿", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "imagingPhlegmon", label: "影像炎性包块", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "freeGas", label: "游离气体", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "imagingPerforation", label: "影像考虑穿孔", type: "select", options: ["有", "无", "未描述", "不确定"] },
      { key: "imaging_perforation_location", label: "影像提示穿孔位置", type: "text", placeholder: "如：阑尾根部/体部；未描述留空" },
    ],
  },
  {
    key: "treatment",
    title: "治疗与时间",
    hint: "能从记录读取的时间可自动识别，其余现场补录",
    types: ["住院病历", "手术记录", "出院小结"],
    fields: [
      { key: "antibioticTime", label: "首次抗生素时间", type: "datetime-local" },
      { key: "operationStartTime", label: "手术开始时间", type: "datetime-local" },
      { key: "treatmentStrategy", label: "治疗策略", type: "select", options: ["直接手术", "抗菌药物/保守治疗", "介入引流后手术", "其他", "未记录"] },
      { key: "surgeryMethod", label: "手术方式", type: "select", options: ["腹腔镜", "开放", "中转开放", "未手术", "未记录"] },
      { key: "laparoscopy_exploration", label: "是否腹腔镜探查", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "laparoscopy_completed", label: "是否完成腹腔镜", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "appendectomy_attempted", label: "是否尝试阑尾切除", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "conversion_to_open", label: "中转开腹", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "conversion_reason", label: "中转开腹原因", type: "textarea", placeholder: "未中转填写“无”，未记录填写“未记录”" },
      { key: "operationDurationMin", label: "手术时间（分钟）", type: "number", step: "1" },
      { key: "drainagePlaced", label: "腹腔引流", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "drainageDurationDays", label: "引流留置时间（天）", type: "number", step: "0.1" },
      { key: "postoperative_antibiotic_name", label: "术后抗生素种类", type: "textarea", placeholder: "药名和方案；未记录填写“未记录”" },
      { key: "postoperative_antibiotic_duration_days", label: "术后抗生素疗程（天）", type: "number", step: "0.1" },
      { key: "icu_admission", label: "ICU入住", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
    ],
  },
  {
    key: "operative",
    title: "术中客观发现",
    hint: "不要直接判断复杂性，先记录客观事实",
    types: ["手术记录"],
    fields: [
      { key: "appendix_macroscopic_status", label: "阑尾大体外观", type: "select", options: ["正常外观", "单纯炎症", "节段性坏死", "根部坏死", "蜂窝织炎/炎性包块", "脓肿", "局限性腹膜炎", "弥漫性腹膜炎", "其他", "未记录"] },
      { key: "necrosis_present", label: "阑尾坏死", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "necrosis_location", label: "坏死部位", type: "select", options: ["无", "节段性", "阑尾根部", "其他", "未描述", "不确定"] },
      { key: "abscess_present", label: "术中脓肿", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "operative_abscess_size_cm", label: "术中脓肿最大径（cm）", type: "number", step: "0.1" },
      { key: "phlegmon_present", label: "术中蜂窝织炎/炎性包块", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "perforation_primary", label: "术中明确穿孔（主要结局）", type: "select", options: ["是", "否", "未记录", "不确定"] },
      { key: "peritoneal_extent", label: "腹膜炎范围", type: "select", options: ["无", "局限性", "弥漫性", "未描述", "不确定"] },
      { key: "contamination_type", label: "腹腔污染性质", type: "select", options: ["无", "清亮", "脓性", "粪性", "混合", "未检查", "未记录", "未描述", "不确定"] },
      { key: "perforation_type", label: "穿孔类型", type: "select", options: ["无", "局限/包裹性", "游离性", "未描述", "不确定"] },
      { key: "free_appendicolith", label: "游离粪石", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "final_wses_grade", label: "原记录明确的WSES分级（可选）", type: "select", options: WSES_GRADE_OPTIONS, advanced: true },
      { key: "grade_source", label: "WSES分级依据来源", type: "select", options: ["手术记录", "腹腔镜视频/照片", "CT报告", "病理报告", "多来源复核", "其他", "未记录"], advanced: true },
      { key: "simpleInflammation", label: "充血/单纯炎症", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "suppuration", label: "化脓", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "gangrene", label: "坏疽", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "operativeAppendicolith", label: "术中粪石", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "operativePurulentExudate", label: "术中脓性渗出/脓液", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
    ],
  },
  {
    key: "labelAdjudication",
    title: "WSES分级复核与Unknown组",
    hint: "视频/照片不可获取时，机器根据手术记录OCR和已录入的术中所见给出WSES默认分级；无法唯一判断时保留“未判定”，不要把未描述当作无。按 0、1、2A、2B、3A、3B（脓肿＜4 cm）、3C（脓肿＞4 cm）、4、5 记录；只写“穿孔”或“腹膜炎”或脓肿恰为4 cm时，保留Unknown原因。",
    types: ["手术记录", "CT", "彩超", "住院病历", "出院小结"],
    fields: [
      { key: "suggested_wses_grade", label: "机器WSES分级（默认归档值）", type: "select", options: WSES_GRADE_OPTIONS },
      { key: "machine_grade_basis", label: "机器分级输入来源", type: "select", options: ["术中记录OCR", "手工录入术中字段", "术中记录OCR+手工修订", "未记录"], advanced: true },
      { key: "machine_grade_algorithm_version", label: "机器分级规则版本", type: "text", defaultValue: "WSES-rule-v1", advanced: true },
      { key: "operative_report_available", label: "手术记录是否可获取", type: "select", options: ["有", "无", "部分/不完整", "未核实"], advanced: true },
      { key: "operative_media_available", label: "腹腔镜视频/照片是否可获取（默认无）", type: "select", options: ["有", "无", "未核实", "不适用"], defaultValue: "无", advanced: true },
      { key: "unknown_reason", label: "Unknown原因", type: "textarea", placeholder: "如：只写腹膜炎，未说明局限/弥漫；缺少手术记录；脓肿大小未报告", advanced: true },
      { key: "reviewer_1_grade", label: "复核者1分级", type: "select", options: WSES_GRADE_OPTIONS, advanced: true },
      { key: "reviewer_2_grade", label: "复核者2分级", type: "select", options: WSES_GRADE_OPTIONS, advanced: true },
      { key: "final_adjudicated_grade", label: "最终仲裁分级", type: "select", options: WSES_GRADE_OPTIONS, advanced: true },
      { key: "reviewer_1_comment", label: "复核者1意见", type: "textarea", placeholder: "记录分级依据或与另一位复核者的差异", advanced: true },
      { key: "reviewer_2_comment", label: "复核者2意见", type: "textarea", placeholder: "记录分级依据或与另一位复核者的差异", advanced: true },
      { key: "label_adjudication_status", label: "标签复核状态", type: "select", options: ["机器建议待确认", "无需复核", "待双人复核", "已完成复核", "无法判定"], advanced: true },
    ],
  },
  {
    key: "pathology",
    title: "病理",
    hint: "病理原文保留，便于以后重新定义分组",
    types: ["病理报告"],
    fields: [
      { key: "pathology_acute_appendicitis_confirmed", label: "病理证实急性阑尾炎", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "pathologyDiagnosis", label: "病理诊断", type: "select", options: ["正常", "急性", "化脓", "坏疽", "其他", "未描述"] },
      { key: "pathologyPerforation", label: "病理穿孔", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "pathologyAppendicolith", label: "病理粪石", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "appendixTumor", label: "阑尾肿瘤", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "pathologyText", label: "病理原文摘录", type: "textarea", placeholder: "可粘贴或手工摘录关键病理描述" },
    ],
  },
  {
    key: "outcomes",
    title: "出院与30天结局",
    hint: "出院时填写一次，30天结局可后续随访补录",
    types: ["出院小结"],
    fields: [
      { key: "discharge_date", label: "出院日期", type: "date" },
      { key: "lengthOfStayDays", label: "总住院天数", type: "number", step: "0.1" },
      { key: "ssi30d", label: "30天切口感染 SSI", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "intraabdominalAbscess30d", label: "30天腹腔脓肿", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "ileusObstruction30d", label: "30天肠梗阻/肠麻痹", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "readmission30d", label: "30天再入院", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "reintervention30d", label: "30天再手术/介入", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "death30d", label: "30天死亡", type: "select", options: APPENDICITIS_VALUE_OPTIONS },
      { key: "clavien_dindo_grade", label: "Clavien-Dindo并发症分级", type: "select", options: ["无并发症", "I", "II", "IIIa", "IIIb", "IVa", "IVb", "V", "未记录"] },
      { key: "otherComplication", label: "其他并发症", type: "textarea", placeholder: "没有就填写“无”，未随访填写“未记录”" },
    ],
  },
];
const APPENDICITIS_FIELD_DEFS = APPENDICITIS_FIELD_GROUPS.flatMap((group) => group.fields.map((field) => ({ ...field, groupKey: group.key, groupTitle: group.title, groupTypes: group.types || [] })));

function detectDocumentType(text) {
  // OCR 常把中文标题识别成“手 术 记 录”“彩 色 多 普 勒”，类型判断必须先去掉中文间隔。
  const haystack = String(text || "").toUpperCase().replace(/[\s\u3000]+/g, "");
  const ranked = documentTypeRules.map((rule) => {
    const matches = rule.terms.filter((term) => haystack.includes(term.toUpperCase()));
    return { ...rule, matches, score: matches.length };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score === 0) return { type: els.recordType.value, confident: false, reason: "未发现明确的类型关键词，请确认资料类型" };
  const reason = `匹配到：${best.matches.slice(0, 4).join("、")}${best.matches.length > 4 ? "…" : ""}`;
  return { type: best.type, confident: best.score >= 1, reason };
}

function normalizeIdentityLabels(text) {
  return String(text || "")
    .replace(/姓\s*[·•.。]?\s*[名各]/g, "姓名")
    .replace(/患\s*者\s*姓\s*[·•.。]?\s*名/g, "患者姓名")
    .replace(/类\s*别/g, "类别")
    .replace(/性\s*别/g, "性别")
    .replace(/病\s*区/g, "病区")
    .replace(/床\s*号/g, "床号")
    .replace(/年\s*龄/g, "年龄")
    .replace(/标\s*本\s*类\s*型/g, "标本类型")
    .replace(/标\s*本\s*号/g, "标本号")
    .replace(/样\s*本\s*说\s*明/g, "样本说明")
    .replace(/申\s*请\s*医\s*生/g, "申请医生")
    .replace(/申\s*请\s*日\s*期/g, "申请日期")
    .replace(/报\s*告\s*日\s*期/g, "报告日期")
    .replace(/检\s*查\s*日\s*期/g, "检查日期")
    .replace(/临\s*床\s*诊\s*断/g, "临床诊断")
    .replace(/申\s*请\s*项\s*目/g, "申请项目")
    .replace(/病\s*[·•.。]?\s*案\s*号/g, "病案号")
    .replace(/病\s*[·•.。]?\s*历\s*号/g, "病历号")
    .replace(/住\s*[·•.。]?\s*院\s*号/g, "住院号")
    .replace(/门\s*[·•.。]?\s*诊\s*号/g, "门诊号")
    .replace(/就\s*[·•.。]?\s*诊\s*号/g, "就诊号")
    .replace(/患\s*者\s*(?:ID|编号)/gi, "患者ID")
    .replace(/科\s*(?:别|室)/g, "科别")
    .replace(/超\s*声\s*号/g, "超声号")
    .replace(/检\s*查\s*号/g, "检查号")
    .replace(/报\s*告\s*号/g, "报告号")
    .replace(/仪\s*器\s*型\s*号/g, "仪器型号");
}

function cleanIdentityValue(value, kind = "name") {
  const nextLabel = /(?:类别|科别|科室|性别|病区|病房|床号|床位号|年龄|标本类型|标本号|申请医生|申请日期|报告日期|检查日期|临床诊断|病案号|住院号|门诊号|患者ID|患者编号|病历号|就诊号|超声号|检查号|报告号|仪器型号)/i;
  const source = String(value || "").replace(/^[\s:：#№No号-]+/i, "").trim().split(nextLabel)[0].trim();
  if (kind === "name") {
    const compact = source.replace(/[\s\u3000]+/g, "");
    // 中文姓名通常为2-6个字，缩短上限可避免把“陈岩科别/年龄”等后续字段吞进姓名。
    return compact.match(/^[\u4e00-\u9fa5]{2,6}(?:[·•][\u4e00-\u9fa5]{1,12})?|^[A-Za-z][A-Za-z .'-]{1,30}/)?.[0] || "";
  }
  return source.replace(/[\s\u3000]+/g, "").match(/^[A-Za-z0-9][A-Za-z0-9\-/]{2,30}/)?.[0] || "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findRawIdentityValue(text, labels, kind) {
  const normalized = normalizeIdentityLabels(text).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  const labelPattern = labels.map(escapeRegExp).join("|");
  const nextLabels = ["类别", "科别", "科室", "性别", "病区", "病房", "床号", "床位号", "年龄", "标本类型", "标本号", "样本说明", "申请医生", "申请日期", "报告日期", "检查日期", "临床诊断", "申请项目", "病案号", "住院号", "门诊号", "患者ID", "患者编号", "病历号", "就诊号", "超声号", "检查号", "报告号", "仪器型号", "Name", "Patient No", "MRN"];
  const nextLabelPattern = nextLabels.map(escapeRegExp).join("|");
  const match = normalized.match(new RegExp(`(?:${labelPattern})\\s*[:：=]?\\s*(.{1,40}?)(?=\\s*(?:${nextLabelPattern})\\s*[:：=]|$)`, "i"));
  return cleanIdentityValue(match?.[1] || "", kind);
}

function findLabeledValue(text, labels, valuePattern) {
  const lines = getTextLines(normalizeIdentityLabels(text));
  const labelOnlyLine = /^(类别|性别|病区|病房|床号|年龄|标本类型|申请医生|申请日期|报告日期|检查日期|临床诊断|病案号|住院号|门诊号|患者ID|患者编号|病历号|就诊号)\s*[:：]?$/i;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const label of labels) {
      const index = line.toLowerCase().indexOf(label.toLowerCase());
      if (index < 0) continue;
      const tail = line.slice(index + label.length).replace(/^[\s:：#№No号-]+/i, "");
      const compactTail = tail.replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "$1").replace(/(?<=\d)\s+(?=\d)/g, "");
      const match = tail.match(valuePattern) || compactTail.match(valuePattern);
      if (match?.[0]) return match[0].trim();
      const nextLine = lines[lineIndex + 1] || "";
      if (!tail && nextLine && !labelOnlyLine.test(nextLine)) {
        const nextMatch = nextLine.match(valuePattern) || nextLine.replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "$1").replace(/(?<=\d)\s+(?=\d)/g, "").match(valuePattern);
        if (nextMatch?.[0]) return nextMatch[0].trim();
      }
    }
  }
  return "";
}

function choosePersonCandidate(candidates, fallback = "") {
  const usable = candidates.filter((candidate) => candidate?.value);
  if (!usable.length) return fallback;
  usable.sort((first, second) => {
    const firstRank = Number(first.score || 0) + (Number(first.priority || 0) * 0.02);
    const secondRank = Number(second.score || 0) + (Number(second.priority || 0) * 0.02);
    return secondRank - firstRank;
  });
  return usable[0].value;
}

function chooseIdentityCandidate(candidates, fallback, kind) {
  const cleanedCandidates = candidates
    .map((candidate) => ({ ...candidate, value: cleanIdentityValue(candidate.value, kind) }))
    .filter((candidate) => candidate.value);
  return choosePersonCandidate(cleanedCandidates, cleanIdentityValue(fallback, kind));
}

function getPersonCandidatesFromBlocks(blocks, labels, pattern) {
  if (!Array.isArray(blocks) || state.ocrEdited) return [];
  return groupOcrBlocksIntoLines(blocks).map((line) => ({
    value: findLabeledValue(line.text, labels, pattern),
    score: line.score,
    priority: line.priority,
  })).filter((candidate) => candidate.value);
}

function detectPerson(text, blocks = []) {
  const normalizedText = normalizeIdentityLabels(text);
  const nameLabels = ["患者姓名", "病人姓名", "患者名", "病人名", "姓名", "Patient Name", "Name"];
  const personIdLabels = ["住院号", "门诊号", "病案号", "病历号", "就诊号", "患者ID", "患者编号", "Patient No", "MRN"];
  const namePattern = /^[\u4e00-\u9fa5]{2,12}(?:·[\u4e00-\u9fa5]{1,12})?|^[A-Za-z][A-Za-z .'-]{1,30}/;
  const personIdPattern = /^[A-Za-z0-9][A-Za-z0-9\-/]{2,30}/;
  const nameFallback = findLabeledValue(normalizedText, nameLabels, namePattern) || findRawIdentityValue(normalizedText, nameLabels, "name");
  const personIdFallback = findLabeledValue(normalizedText, personIdLabels, personIdPattern) || findRawIdentityValue(normalizedText, personIdLabels, "id");
  const name = chooseIdentityCandidate(getPersonCandidatesFromBlocks(blocks, nameLabels, namePattern), nameFallback, "name");
  const personId = chooseIdentityCandidate(getPersonCandidatesFromBlocks(blocks, personIdLabels, personIdPattern), personIdFallback, "id");
  const identityLabelFound = /(?:患者|病人)?\s*(?:姓\s*名|名)|病案号|病历号|住院号|门诊号|就诊号|患者ID|患者编号|Patient\s+Name|Patient\s+No|MRN/i.test(normalizedText);
  const reason = name && personId
    ? `已识别姓名“${name}”和编号“${personId}”`
    : name
      ? `已识别姓名“${name}”；未识别到病案/住院/就诊号（请确认原报告是否填写）`
    : personId
      ? `已识别编号“${personId}”；姓名未识别`
        : identityLabelFound
          ? "OCR 原文中读到了个人信息标签，但标签后没有可确认的姓名或编号，请放大表头重拍"
          : "OCR 原文中未读到姓名、病案号或就诊号标签，请检查 OCR 原文或重拍";
  return {
    name,
    personId,
    confident: Boolean(name || personId),
    reason,
  };
}

function getOcrPageTextMap(text = "") {
  const source = String(text || "");
  const matches = [...source.matchAll(/【\s*第\s*(\d+)\s*张图片\s*】/g)];
  if (!matches.length) return new Map([[0, source]]);
  const pages = new Map();
  matches.forEach((match, index) => {
    const page = Math.max(0, Number(match[1]) - 1);
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? source.length) : source.length;
    pages.set(page, source.slice(start, end).trim());
  });
  return pages;
}

function getBatchIdentityAudit(text = "", blocks = []) {
  const usableBlocks = state.ocrEdited ? [] : (Array.isArray(blocks) ? blocks : []);
  const detectedPages = usableBlocks.map((block) => Number(block.page)).filter(Number.isFinite);
  const pageCount = Math.max(1, state.images.length, detectedPages.length ? Math.max(...detectedPages) + 1 : 0);
  const pageTextMap = getOcrPageTextMap(text);
  const pages = [];
  for (let page = 0; page < pageCount; page += 1) {
    const pageBlocks = usableBlocks.filter((block) => Number(block.page) === page);
    const pageText = pageBlocks.length ? buildOcrTextFromBlocks(pageBlocks) : pageTextMap.get(page) || (page === 0 && !pageTextMap.size ? String(text || "") : "");
    const identity = detectPerson(pageText, pageBlocks);
    const type = detectDocumentType(pageText);
    const metricCount = labFieldRules[type.type] ? extractAllLabRows(pageText, pageBlocks, type.type).length : 0;
    pages.push({ page: page + 1, name: identity.name, personId: identity.personId, type: type.confident ? type.type : "", metricCount });
  }
  const uniqueNames = [...new Map(pages.filter((page) => page.name).map((page) => [normalizeIdentityToken(page.name), page.name])).values()];
  const uniqueIds = [...new Map(pages.filter((page) => page.personId).map((page) => [normalizeIdentityToken(page.personId), page.personId])).values()];
  const uniqueTypes = [...new Set(pages.map((page) => page.type).filter(Boolean))];
  return {
    pageCount,
    pages,
    names: uniqueNames,
    personIds: uniqueIds,
    types: uniqueTypes,
    identityConflict: uniqueNames.length > 1 || uniqueIds.length > 1,
    mixedTypes: uniqueTypes.length > 1,
    pagesWithIdentity: pages.filter((page) => page.name || page.personId).length,
    totalMetrics: pages.reduce((sum, page) => sum + page.metricCount, 0),
  };
}

function renderQualitySummary(text = els.ocrText?.value || "") {
  if (!els.qualitySummary) return;
  if (!text.trim() && !state.images.length) {
    els.qualitySummary.hidden = true;
    state.batchAudit = null;
    return;
  }
  const audit = getBatchIdentityAudit(text, state.ocrBlocks);
  state.batchAudit = audit;
  const manualIdentity = Boolean(els.personName?.value.trim() || els.personId?.value.trim());
  const issues = [];
  if (audit.identityConflict) issues.push(`跨页身份不一致：${audit.names.join("、") || ""}${audit.personIds.length ? ` / ${audit.personIds.join("、")}` : ""}`);
  if (audit.mixedTypes) issues.push(`同批次包含多种资料类型：${audit.types.join("、")}，建议分开归档`);
  if (!audit.pagesWithIdentity && !manualIdentity) issues.push("尚未确认患者姓名或病案/就诊号");
  const stateName = issues.length ? "warning" : "ok";
  els.qualitySummary.hidden = false;
  els.qualitySummary.dataset.state = stateName;
  els.qualitySummaryTitle.textContent = issues.length ? "需要处理批次质控提示" : "批次质控通过，可继续校对";
  const learnedCount = getHospitalCorrections().length;
  els.qualitySummaryDetail.textContent = `${audit.pageCount} 张图片 · ${audit.pagesWithIdentity}/${audit.pageCount} 页读到身份 · ${audit.types.length ? audit.types.join("、") : "类型待确认"} · ${audit.totalMetrics || 0} 条表格指标 · 本院校正 ${learnedCount} 条${issues.length ? `；${issues.join("；")}` : "；未发现跨页身份冲突"}`;
}

function getTextLines(text) {
  return text.split(/\r?\n/).map((line) => line.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
}

function groupOcrBlocksIntoLines(blocks = []) {
  const usable = blocks.filter((block) => block?.text?.trim() && Array.isArray(block.poly) && block.poly.length);
  if (!usable.length) return [];
  const items = usable.map((block) => {
    const xs = block.poly.map((point) => point[0]);
    const ys = block.poly.map((point) => point[1]);
    const x = Math.min(...xs);
    const right = Math.max(...xs);
    return { text: block.text.trim(), score: Number(block.score ?? 0), page: Number(block.page ?? 0), variantPriority: Number(block.variantPriority ?? 0), x, right, width: right - x, centerX: (x + right) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, height: Math.max(...ys) - Math.min(...ys), poly: block.poly };
  }).sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const medianHeight = [...items].sort((a, b) => a.height - b.height)[Math.floor(items.length / 2)]?.height || 18;
  const tolerance = Math.max(8, medianHeight * 0.65);
  const lines = [];
  items.forEach((item) => {
    const line = lines.find((candidate) => candidate.page === item.page && Math.abs(candidate.y - item.y) <= tolerance);
    if (line) {
      line.items.push(item);
      line.y = (line.y + item.y) / 2;
    } else lines.push({ page: item.page, y: item.y, items: [item] });
  });
  return lines.sort((a, b) => a.page - b.page || a.y - b.y).map((line) => ({
    text: line.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim(),
    score: line.items.reduce((sum, item) => sum + item.score, 0) / line.items.length,
    priority: Math.max(...line.items.map((item) => item.variantPriority || 0)),
    items: line.items,
    page: line.page,
  }));
}

function getLabLines(text, blocks = []) {
  const blockLines = state.ocrEdited ? [] : groupOcrBlocksIntoLines(blocks);
  if (blockLines.length) return blockLines;
  return getTextLines(text).map((line) => ({ text: line, score: null, items: [] }));
}

function isLabHeader(line) {
  return /项目/.test(line) && /(结果|参考范围|参考值|单位|英文缩写|缩写)/.test(line);
}

function isLabFooter(line) {
  return /采集时间|接收时间|报告时间|检验医生|审核人|授权人|备注|临床诊断|样本说明/.test(line);
}

function inferLabFlag(value, reference) {
  const result = Number.parseFloat(String(value).replace(/,/g, ""));
  const bounds = [...String(reference || "").matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => Number.parseFloat(match[0].replace(/,/g, "")));
  if (!Number.isFinite(result) || bounds.length < 2 || !bounds.every(Number.isFinite)) return "";
  if (result < bounds[0]) return "↓（超出参考范围）";
  if (result > bounds[1]) return "↑（超出参考范围）";
  return "";
}

const HOSPITAL_LAB_ABBREVIATIONS = [
  { names: ["白细胞计数", "白细胞"], abbreviation: "WBC" },
  { names: ["中性粒细胞百分比"], abbreviation: "NEUT%" },
  { names: ["淋巴细胞百分比"], abbreviation: "LYMPH%" },
  { names: ["单核细胞百分比"], abbreviation: "MONO%" },
  { names: ["嗜酸性粒细胞百分比"], abbreviation: "EO%" },
  { names: ["嗜碱性粒细胞百分比"], abbreviation: "BASO%" },
  { names: ["中性粒细胞绝对数"], abbreviation: "NEUT#" },
  { names: ["淋巴细胞绝对数"], abbreviation: "LYMPH#" },
  { names: ["单核细胞绝对数"], abbreviation: "MONO#" },
  { names: ["嗜酸性粒细胞绝对数"], abbreviation: "EO#" },
  { names: ["嗜碱性粒细胞绝对数"], abbreviation: "BASO#" },
  { names: ["红细胞计数", "红细胞"], abbreviation: "RBC" },
  { names: ["血红蛋白"], abbreviation: "HGB" },
  { names: ["红细胞比容", "红细胞压积"], abbreviation: "HCT" },
  { names: ["平均红细胞体积"], abbreviation: "MCV" },
  { names: ["平均红细胞血红蛋白含量", "平均血红蛋白含量"], abbreviation: "MCH" },
  { names: ["平均红细胞血红蛋白浓度", "平均血红蛋白浓度"], abbreviation: "MCHC" },
  { names: ["红细胞分布宽度CV值", "红细胞分布宽度-CV值"], abbreviation: "RDW-CV" },
  { names: ["红细胞分布宽度SD值", "红细胞分布宽度-SD值"], abbreviation: "RDW-SD" },
  { names: ["血小板计数", "血小板"], abbreviation: "PLT" },
  { names: ["血小板压积"], abbreviation: "PCT" },
  { names: ["血小板分布宽度"], abbreviation: "PDW" },
  { names: ["平均血小板体积"], abbreviation: "MPV" },
  { names: ["大血小板比率"], abbreviation: "P-LCR" },
  { names: ["总蛋白"], abbreviation: "TP" },
  { names: ["白蛋白"], abbreviation: "ALB" },
  { names: ["球蛋白"], abbreviation: "GLO" },
  { names: ["白蛋白/球蛋白比值", "白蛋白球蛋白比值"], abbreviation: "A/G" },
  { names: ["总胆红素"], abbreviation: "TBIL" },
  { names: ["直接胆红素"], abbreviation: "DBIL" },
  { names: ["间接胆红素"], abbreviation: "IBIL" },
  { names: ["丙氨酸氨基转移酶", "谷丙转氨酶"], abbreviation: "ALT" },
  { names: ["天门冬氨酸氨基转移酶", "谷草转氨酶"], abbreviation: "AST" },
  { names: ["碱性磷酸酶"], abbreviation: "ALP" },
  { names: ["γ-谷氨酰基转移酶", "γ谷氨酰基转移酶", "谷氨酰转移酶"], abbreviation: "GGT" },
  { names: ["肌酐"], abbreviation: "CREA" },
  { names: ["尿素"], abbreviation: "UREA" },
  { names: ["尿酸"], abbreviation: "UA" },
  { names: ["凝血酶原时间"], abbreviation: "PT" },
  { names: ["国际标准化比值"], abbreviation: "INR" },
  { names: ["活化部分凝血活酶时间"], abbreviation: "APTT" },
  { names: ["纤维蛋白原"], abbreviation: "FIB" },
  { names: ["凝血酶时间"], abbreviation: "TT" },
  { names: ["D-二聚体", "D二聚体"], abbreviation: "D-DIMER" },
];

function normalizeLabMetricName(name) {
  return String(name || "")
    .replace(/\bRBC\b/gi, "红细胞")
    .replace(/哮(?=(?:中|酸|碱))/g, "嗜")
    .replace(/[ \t]+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/：/g, ":");
}

function normalizeLabAbbreviation(abbreviation, name = "", unit = "", recordType = "") {
  const rawCompact = String(abbreviation || "").replace(/[ \t]+/g, "").toUpperCase();
  const learned = findHospitalCorrection(rawCompact, name, unit, recordType);
  if (learned) return learned;
  const compact = rawCompact.replace(/^E0(?=[%#]?)/, "EO");
  const normalizedName = normalizeLabMetricName(name);
  if (/^EO[%#]{2}$/.test(compact) || /^EO[%#]$/.test(compact) && /嗜酸性粒细胞/.test(normalizedName)) {
    if (/绝对数|#/.test(normalizedName)) return "EO#";
    if (/百分比|%/.test(normalizedName)) return "EO%";
    return compact.includes("#") ? "EO#" : "EO%";
  }
  const known = HOSPITAL_LAB_ABBREVIATIONS.find((item) => item.names.some((candidate) => normalizeLabMetricName(candidate) === normalizedName));
  return known?.abbreviation || compact;
}

const LAB_UNIT_PATTERN = /(?:[×xX]\s*10\s*(?:\^|°)?\s*\d+\s*\/?\s*[A-Za-zμ]+|10\s*(?:\^|°)\s*\d+\s*\/?\s*[A-Za-zμ]+|mg\s*\/\s*dL|mg\s*\/\s*L|g\s*\/\s*L|mmol\s*\/\s*L|μmol\s*\/\s*L|U\s*\/\s*L|IU\s*\/\s*L|mIU\s*\/\s*L|mmHg|fL|pg|mL|秒|%)/i;

function normalizeLabLine(line) {
  return String(line || "")
    .replace(/[|｜]/g, " ")
    .replace(/(\d)\s*([.,])\s*(\d)/g, "$1$2$3")
    .replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "$1")
    .replace(/哮(?=(?:中|酸|碱))/g, "嗜")
    .replace(/\bE\s*0\s*([%#])?/gi, (_, marker) => `EO${marker || ""}`)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLabUnit(unit, name = "") {
  let normalized = String(unit || "").replace(/\s+/g, "").replace(/^x/i, "×").replace(/°/g, "^");
  normalized = normalized.replace(/(×?10)(\d+)(?=\/)/, "$1^$2");
  if (!normalized && /百分比/.test(name)) return "%";
  return normalized;
}

function getLabNumberMatches(text) {
  return [...String(text || "").matchAll(/(?<![A-Za-z^°])[-+]?\d+(?:[.,]\d+)?/g)].map((match) => ({
    value: match[0],
    index: match.index ?? 0,
  }));
}

function getLineSourceBox(line) {
  const points = (line?.items || []).flatMap((item) => Array.isArray(item.poly) ? item.poly : []);
  if (!points.length) return "";
  const xs = points.map((point) => Number(point[0])).filter(Number.isFinite);
  const ys = points.map((point) => Number(point[1])).filter(Number.isFinite);
  if (!xs.length || !ys.length) return "";
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y].map((value) => Math.round(value)).join(",");
}

function isLikelyLabAbbreviation(value) {
  const compact = String(value || "").replace(/[\s:：]/g, "").toUpperCase().replace(/^E0(?=[%#]?)/, "EO");
  const generic = /^[A-Z][A-Z0-9./-]{0,15}(?:[%#]{1,2})?$/.test(compact)
    && !/^(?:NO|NAME|MRN|ID|CT|US)$/.test(compact);
  const known = /^(?:WBC|RBC|HGB|HB|PLT|NEUT|LYMPH|LYM|MONO|EO|E0|BASO|EOS|MCV|MCH|MCHC|RDW|PCT|PDW|MPV|FIB|PT|INR|APTT|TT|ALT|AST|ALP|GGT|CREA|CR|BUN|UREA|UA|TBIL|DBIL|IBIL|ALB|TP|GLO)(?:[%#]|-[A-Z]+)?$/.test(compact);
  return generic || known;
}

function parseStructuredLabLine(line, score = 0, recordType = "") {
  const items = (line?.items || []).slice().sort((first, second) => first.x - second.x);
  if (items.length < 3 || isLabHeader(line?.text || "") || isLabFooter(line?.text || "")) return null;
  const tokens = items.map((item) => normalizeLabLine(item.text));
  const abbreviationIndex = tokens.findIndex((token) => isLikelyLabAbbreviation(token));
  if (abbreviationIndex <= 0) return null;
  const rawName = tokens.slice(0, abbreviationIndex).join("");
  if (!rawName || /^(?:项目|英文缩写|结果|异常提示|参考范围|参考值|单位)/.test(rawName)) return null;
  const rawAbbreviation = tokens[abbreviationIndex].replace(/[\s:：]/g, "");
  const afterAbbreviation = normalizeLabLine(tokens.slice(abbreviationIndex + 1).join(" "));
  const firstNumber = getLabNumberMatches(afterAbbreviation)[0];
  if (!firstNumber) return null;
  const afterValue = afterAbbreviation.slice(firstNumber.index + firstNumber.value.length).trim();
  const referenceMatch = afterValue.match(/(\d+(?:[.,]\d+)?\s*(?:-|~|～|至)\s*\d+(?:[.,]\d+)?|<\s*\d+(?:[.,]\d+)?|>\s*\d+(?:[.,]\d+)?)/);
  const rawUnit = afterValue.match(LAB_UNIT_PATTERN)?.[0] || "";
  const name = normalizeLabMetricName(rawName);
  const unit = normalizeLabUnit(rawUnit, name);
  const flagSource = tokens.slice(abbreviationIndex + 1).join(" ");
  const rawFlag = flagSource.match(/(?:\bHH\b|\bLL\b|\bH\b|\bL\b|↑+|↓+|←|→|高|低|异常|危急|阳性|阴性)/i)?.[0] || "";
  const flag = rawFlag || inferLabFlag(firstNumber.value, referenceMatch?.[1] || "");
  return {
    name,
    abbreviation: normalizeLabAbbreviation(rawAbbreviation, name, unit, recordType),
    value: firstNumber.value,
    unit,
    reference: referenceMatch?.[1] || "",
    flag,
    confidence: score,
    rawName,
    rawAbbreviation,
    rawValue: firstNumber.value,
    rawReference: referenceMatch?.[1] || "",
    rawUnit,
    rawFlag,
    sourceText: line.text || tokens.join(" "),
    sourceBox: getLineSourceBox(line),
  };
}

function parseLabLine(line, score = 0, recordType = "") {
  const normalized = normalizeLabLine(line);
  if (!normalized || isLabHeader(normalized) || isLabFooter(normalized)) return null;
  const numbers = getLabNumberMatches(normalized);
  if (!numbers.length) return null;
  const first = numbers[0];
  const beforeValue = normalized.slice(0, first.index).trim();
  const afterValue = normalized.slice(first.index + first.value.length).trim();
  const referenceMatch = afterValue.match(/(\d+(?:[.,]\d+)?\s*(?:-|~|～|至)\s*\d+(?:[.,]\d+)?|<\s*\d+(?:[.,]\d+)?|>\s*\d+(?:[.,]\d+)?)/);
  const abbreviation = beforeValue.match(/(?:^|\s)([A-Za-z][A-Za-z0-9./-]{0,15}(?:[%#])?)(?=\s|$)\s*$/)?.[1] || "";
  const rawName = abbreviation ? beforeValue.slice(0, beforeValue.lastIndexOf(abbreviation)).trim() : beforeValue;
  const name = normalizeLabMetricName(rawName);
  const rawUnit = afterValue.match(LAB_UNIT_PATTERN)?.[0] || "";
  const unit = normalizeLabUnit(rawUnit, name) || (/百分比/.test(name) && /(?:多|％)/.test(afterValue) ? "%" : "");
  const canonicalAbbreviation = normalizeLabAbbreviation(abbreviation, name, unit, recordType);
  const flagSource = normalized.replace(new RegExp(LAB_UNIT_PATTERN.source, "gi"), " ");
  const rawFlag = flagSource.match(/(?:\bHH\b|\bLL\b|\bH\b|\bL\b|↑+|↓+|←|→|高|低|异常|危急|阳性|阴性)/i)?.[0] || "";
  const inferredFlag = inferLabFlag(first.value, referenceMatch?.[1] || "");
  const flag = rawFlag === "←" || rawFlag === "→" ? (inferredFlag || `${rawFlag}（疑似异常符号）`) : rawFlag || inferredFlag;
  if (!name || name.length > 80) return null;
  return { name, abbreviation: canonicalAbbreviation, value: first.value, unit: unit.trim(), reference: referenceMatch?.[1] || "", flag, confidence: score, rawName, rawAbbreviation: abbreviation, rawValue: first.value, rawReference: referenceMatch?.[1] || "", rawUnit, rawFlag, sourceText: normalized };
}

function parseMergedLabLine(line, score = 0, recordType = "") {
  const normalized = normalizeLabLine(line);
  if (!normalized || isLabHeader(normalized) || isLabFooter(normalized)) return null;
  const firstNumberIndex = getLabNumberMatches(normalized)[0]?.index ?? -1;
  if (firstNumberIndex < 0) return null;
  const prefix = normalized.slice(0, firstNumberIndex).trim();
  const abbreviations = [...prefix.matchAll(/\b[A-Z][A-Za-z0-9./-]{0,15}(?:[%#])?(?=\s|$)/g)];
  if (abbreviations.length < 2) return null;
  const numberTokens = [...normalized.matchAll(/(?<![A-Za-z^°])[-+]?\d+(?:[.,]\d+)?(?:\s*(?:-|~|～|至)\s*[-+]?\d+(?:[.,]\d+)?)?/g)].map((match) => match[0].replace(/\s+/g, ""));
  const count = Math.min(abbreviations.length, Math.floor(numberTokens.length / 2));
  if (count < 2) return null;
  const namePrefix = prefix.slice(0, abbreviations[0].index).trim();
  const nameParts = namePrefix.split(/\s+/).filter(Boolean);
  if (nameParts.length < count) return null;
  const names = nameParts.length === count
    ? nameParts
    : [...nameParts.slice(0, count - 1), nameParts.slice(count - 1).join(" ")];
  const unitMatches = [...normalized.slice(firstNumberIndex).matchAll(new RegExp(LAB_UNIT_PATTERN.source, "gi"))].map((match) => normalizeLabUnit(match[0].trim()));
  return names.map((name, index) => {
    const value = numberTokens[index];
    const reference = numberTokens[count + index] || "";
    const unit = unitMatches[index] || unitMatches[0] || "";
    return {
      name: normalizeLabMetricName(name),
      abbreviation: normalizeLabAbbreviation(abbreviations[index][0], name, unit, recordType),
      value,
      unit,
      reference,
      flag: inferLabFlag(value, reference),
      confidence: score,
      rawName: name,
      rawAbbreviation: abbreviations[index][0],
      rawValue: value,
      rawReference: reference,
      rawUnit: unit,
      sourceText: normalized,
    };
  });
}

function extractAllLabRows(text, blocks = [], recordType = els.recordType?.value || "") {
  const lines = getLabLines(text, blocks);
  const hasGeometry = lines.some((line) => line.items?.length);
  const candidates = [];
  let tableStarted = false;
  lines.forEach((line) => {
    if (isLabHeader(line.text)) {
      tableStarted = true;
      return;
    }
    if (isLabFooter(line.text)) return;
    if (!hasGeometry || tableStarted) candidates.push(line);
  });
  if (hasGeometry && !tableStarted) candidates.push(...lines);
  const rows = [];
  for (const line of candidates) {
    const structured = parseStructuredLabLine(line, line.score, recordType);
    const parsedRows = structured
      ? [structured]
      : parseMergedLabLine(line.text, line.score, recordType)
        || [parseLabLine(line.text, line.score, recordType)].filter(Boolean);
    const sourcePage = Number.isFinite(Number(line.page)) ? Number(line.page) + 1 : "";
    for (const parsed of parsedRows) {
      const next = parsed ? { ...parsed, sourcePage, sourceBox: parsed.sourceBox || getLineSourceBox(line), sourceText: parsed.sourceText || line.text } : null;
      if (next && !rows.some((row) => row.name === next.name && row.abbreviation === next.abbreviation && row.value === next.value && row.sourcePage === next.sourcePage)) rows.push(next);
    }
  }
  return rows;
}

function renderMetricTable(text, type) {
  const rows = labFieldRules[type] ? extractAllLabRows(text, state.ocrBlocks, type) : [];
  const sourceRows = rows.map((row) => ({
    ...row,
    rawName: row.rawName || row.name || "",
    rawAbbreviation: row.rawAbbreviation || row.abbreviation || "",
    rawValue: row.rawValue || row.value || "",
    rawReference: row.rawReference || row.reference || "",
    rawUnit: row.rawUnit || row.unit || "",
    rawFlag: row.rawFlag || row.flag || "",
  }));
  state.currentMetrics = sourceRows.map((row) => ({ ...row }));
  state.metricSourceRows = sourceRows.map((row) => ({ ...row }));
  els.metricTableWrap.hidden = !rows.length;
  els.metricTableBody.innerHTML = rows.map((row, index) => {
    const hasConfidence = Number.isFinite(row.confidence);
    const confidence = hasConfidence ? Math.round(row.confidence * 100) : null;
    const confidenceLabel = hasConfidence ? `${confidence}%` : "未提供";
    const confidenceClass = !hasConfidence || confidence < 60 ? "low-confidence" : confidence < 80 ? "medium-confidence" : "";
    const editable = (field, value, placeholder = "") => `<input class="metric-edit" data-metric-field="${field}" data-metric-index="${index}" value="${escapeHtml(value || "")}" placeholder="${escapeHtml(placeholder)}" />`;
    return `<tr><td>${editable("name", row.name, "项目名称")}</td><td>${editable("abbreviation", row.abbreviation, "缩写")}</td><td>${editable("value", row.value, "结果")}</td><td>${editable("reference", row.reference, "参考范围")}</td><td>${editable("unit", row.unit, "单位")}</td><td>${editable("flag", row.flag, "异常提示")}</td><td>${row.sourcePage ? `第${row.sourcePage}张` : "—"}</td><td class="${confidenceClass}">${confidenceLabel}</td></tr>`;
  }).join("");
}

function getEditableMetricRows() {
  if (!els.metricTableBody) return state.currentMetrics.map((row) => ({ ...row }));
  const tableRows = [...els.metricTableBody.querySelectorAll("tr")];
  return tableRows.map((tableRow, index) => {
    const original = state.currentMetrics[index] || {};
    const source = state.metricSourceRows[index] || original;
    const next = { ...original };
    tableRow.querySelectorAll("[data-metric-field]").forEach((input) => {
      next[input.dataset.metricField] = input.value.trim();
    });
    next.name = normalizeLabMetricName(next.name);
    next.abbreviation = normalizeLabAbbreviation(next.abbreviation, next.name, next.unit, els.recordType?.value || "");
    const editableFields = ["name", "abbreviation", "value", "reference", "unit", "flag"];
    const editedFields = editableFields.filter((field) => String(next[field] || "") !== String(source[field] || ""));
    if (editedFields.length) {
      next.manualEdited = true;
      next.editedFields = editedFields;
      next.reviewStatus = "人工修改待确认";
    }
    return next;
  }).filter((row) => row.name || row.value || row.abbreviation);
}

function buildSummaryFromMetrics(type, metrics) {
  if (!metrics.length) return "";
  const lines = metrics.map((row) => `${row.name || "未命名指标"}${row.abbreviation ? ` [${row.abbreviation}]` : ""}：${row.value || ""}${row.unit ? ` ${row.unit}` : ""}${row.reference ? `（参考 ${row.reference}）` : ""}${row.flag ? ` · ${row.flag}` : ""}`);
  return `${type}（人工复核后结构化，共 ${metrics.length} 项）\n${lines.join("\n")}\n\n提示：请将此结构化结果与原图逐项核对。`;
}

function extractReportSection(text, labels) {
  const lines = getTextLines(text);
  const compactLines = lines.map((line) => line.replace(/[\s\u3000]+/g, ""));
  const index = compactLines.findIndex((line) => labels.some((label) => line.includes(label.replace(/[\s\u3000]+/g, ""))));
  if (index < 0) return "";
  const source = lines[index];
  const compactSource = compactLines[index];
  const label = labels.find((item) => compactSource.includes(item.replace(/[\s\u3000]+/g, "")));
  const compactLabel = label?.replace(/[\s\u3000]+/g, "") || "";
  const labelIndex = compactSource.indexOf(compactLabel);
  let sourceOffset = 0;
  let compactOffset = 0;
  while (sourceOffset < source.length && compactOffset < labelIndex + compactLabel.length) {
    if (!/[\s\u3000]/.test(source[sourceOffset])) compactOffset += 1;
    sourceOffset += 1;
  }
  const sameLine = source.slice(sourceOffset).replace(/^\s*[:：-]?\s*/, "").trim();
  if (sameLine) return sameLine;
  return lines.slice(index + 1, index + 6).filter((line) => !["所见", "检查所见", "印象", "结论", "提示"].some((stop) => line.replace(/[\s\u3000]+/g, "").startsWith(stop))).join(" ");
}

function buildSummary(text, type) {
  if (!text.trim()) return "";
  if (labFieldRules[type]) {
    const rows = extractAllLabRows(text, state.ocrBlocks);
    if (rows.length) {
      const lines = rows.map((row) => `${row.name}${row.abbreviation ? ` [${row.abbreviation}]` : ""}：${row.value}${row.unit ? ` ${row.unit}` : ""}${row.reference ? `（参考 ${row.reference}）` : ""}${row.flag ? ` · ${row.flag}` : ""}${row.confidence > 0 && row.confidence < 0.75 ? " · 低置信度，需复核" : ""}`);
      return `${type}（自动归纳，共 ${rows.length} 项）\n${lines.join("\n")}\n\n提示：以上为 OCR 逐行结构化结果，请对照原图核对每一项数值、单位和参考范围。`;
    }
    const fallbackLines = getLabLines(text, state.ocrBlocks).filter((line) => /\d/.test(line.text) && !isLabFooter(line.text)).map((line) => line.text).slice(0, 80);
    return `${type}（自动归纳）\n未能可靠分割表格列，保留识别到的 ${fallbackLines.length} 行待校对内容：\n${fallbackLines.join("\n")}\n\n提示：请人工核对并补充项目名称、结果、单位和参考范围。`;
  }
  const site = extractReportSection(text, ["检查部位", "检查项目", "检查名称", "部位"]);
  const findings = extractReportSection(text, ["检查所见", "所见", "影像所见", "描述"]);
  const impression = extractReportSection(text, ["印象", "结论", "提示", "诊断意见"]);
  const summary = [`${type}（自动归纳）`, site ? `检查部位：${site}` : "", findings ? `所见：${findings}` : "", impression ? `印象/结论：${impression}` : ""].filter(Boolean).join("\n");
  return `${summary || `${type}\n已提取原文，请人工整理检查部位、所见和印象/结论。`}\n\n提示：自动归纳仅整理报告原文，不代表诊断意见。`;
}

const SUMMARY_MODE_HINTS = {
  research: "按资料类型、报告时间、异常指标和全部指标生成科研摘要",
  "all-metrics": "把当前识别到的所有指标按项目、缩写、结果和参考范围列出",
  "abnormal-metrics": "只突出异常标记或低置信度项目，适合快速复核",
  imaging: "按检查部位、所见、印象/结论整理影像报告",
  raw: "保留 OCR 原文中的前部重点行，适合手动二次整理",
};

function getCurrentSummaryMetrics(text, type) {
  if (!labFieldRules[type]) return [];
  const editedRows = getEditableMetricRows();
  if (state.currentMetrics.length && editedRows.length) return editedRows;
  return extractAllLabRows(text, state.ocrBlocks);
}

function formatSummaryMetric(row) {
  const page = row.sourcePage ? `（第${row.sourcePage}张）` : "";
  return `${row.name || "未命名指标"}${row.abbreviation ? ` [${row.abbreviation}]` : ""}${page}：${row.value || "未填写"}${row.unit ? ` ${row.unit}` : ""}${row.reference ? `（参考 ${row.reference}）` : ""}${row.flag ? ` · ${row.flag}` : ""}`;
}

function isMetricForReview(row) {
  const confidence = Number(row.confidence);
  return Boolean(String(row.flag || "").trim()) || (String(row.confidence ?? "").trim() !== "" && Number.isFinite(confidence) && confidence < 0.75);
}

function getCurrentAppendicitisData() {
  if (els.appendicitisEnabled?.checked === false) return {};
  return { ...(state.appendicitisData || {}), ...getAppendicitisDataFromForm() };
}

function buildAppendicitisResearchSummary(data = getCurrentAppendicitisData()) {
  const filledFields = APPENDICITIS_FIELD_DEFS.filter((field) => isAppendicitisValueFilled(data[field.key]));
  if (!filledFields.length) return "";
  const evidenceFields = [
    ["研究分组", data.perforationStatus],
    ["影像", data.imagingPerforation],
    ["术中", data.perforation_primary],
    ["病理", data.pathologyPerforation],
  ].filter(([, value]) => isAppendicitisValueFilled(value));
  const evidence = evidenceFields.length
    ? evidenceFields.map(([source, value]) => `${source}：${value}`).join("；")
    : "未补录";
  const wses = [
    ["机器建议", data.suggested_wses_grade],
    ["现场标签", data.final_wses_grade],
    ["最终仲裁", data.final_adjudicated_grade],
  ].filter(([, value]) => isAppendicitisValueFilled(value)).map(([source, value]) => `${source}：${value}`).join("；") || "未判定";
  const sections = APPENDICITIS_FIELD_GROUPS.map((group) => {
    const rows = group.fields.filter((field) => isAppendicitisValueFilled(data[field.key]));
    if (!rows.length) return "";
    return `${group.title}\n${rows.map((field) => `${field.label}：${data[field.key]}`).join("；")}`;
  }).filter(Boolean);
  return `急性阑尾炎科研摘要\n穿孔相关证据（按记录来源）：${evidence}\nWSES分级：${wses}\n\n${sections.join("\n\n")}\n\n提示：当前按“无腹腔镜视频/照片”设计，机器建议依据术中记录OCR和已录入的术中所见生成，可作为科研归档的默认分组；机器输入来源和复核状态会一并导出。对未描述内容不作“无”的推断；若需要把机器结果直接作为最终研究标签，应在研究方案中预先规定并单独标记。`;
}

function appendAppendicitisResearchSummary(baseSummary, mode = state.summaryMode) {
  if (mode !== "research") return baseSummary;
  const clinicalSummary = buildAppendicitisResearchSummary();
  return clinicalSummary ? `${clinicalSummary}\n\n${baseSummary}` : baseSummary;
}

function buildSummaryByMode(text, type, mode = state.summaryMode) {
  const source = String(text || "").trim();
  if (!source) return "";
  if (labFieldRules[type]) {
    const metrics = getCurrentSummaryMetrics(source, type);
    if (!metrics.length) return appendAppendicitisResearchSummary(buildSummary(source, type), mode);
    const flagged = metrics.filter(isMetricForReview);
    const reportDate = typeof getReportDate === "function" ? getReportDate(source) : "";
    const identity = [els.personName?.value.trim(), els.personId?.value.trim()].filter(Boolean).join(" · ");
    const contextLine = [identity ? `个人：${identity}` : "", reportDate ? `报告时间：${reportDate}` : "", `指标总数：${metrics.length}`, `异常/待复核：${flagged.length}`].filter(Boolean).join("；");
    if (mode === "abnormal-metrics") {
      return `${type}（异常/待复核优先）\n${contextLine}\n\n${flagged.length ? flagged.map(formatSummaryMetric).join("\n") : "未识别到异常标记；仍需对照原图确认全部指标。"}\n\n提示：低置信度项目也会列入待复核，请不要仅凭自动标记判断临床意义。`;
    }
    if (mode === "all-metrics") {
      return `${type}（全部指标清单，共 ${metrics.length} 项）\n${contextLine}\n\n${metrics.map(formatSummaryMetric).join("\n")}\n\n提示：以上为结构化录入结果，请对照原图逐项核对。`;
    }
    if (mode === "research") {
      const flaggedLines = flagged.length ? flagged.map(formatSummaryMetric).join("\n") : "未识别到异常标记";
      return appendAppendicitisResearchSummary(`${type}（科研摘要）\n${contextLine}\n\n异常/待复核指标：\n${flaggedLines}\n\n全部指标明细：\n${metrics.map(formatSummaryMetric).join("\n")}\n\n提示：摘要仅用于临床资料整理，不代表诊断意见；归档前请完成逐项人工复核。`, mode);
    }
  }
  if (mode === "raw") {
    const lines = getTextLines(source).filter((line) => line.trim() && !isLabFooter(line)).slice(0, 18);
    return `${type}（原文重点）\n${lines.join("\n")}\n\n提示：请根据原图补充或修订检查部位、所见和印象/结论。`;
  }
  return appendAppendicitisResearchSummary(buildSummary(source, type), mode);
}

function updateSummaryMeta() {
  if (!els.summaryMeta || !els.summaryEditStatus) return;
  const text = els.summaryText?.value || "";
  const metrics = labFieldRules[els.recordType?.value] ? getCurrentSummaryMetrics(els.ocrText?.value || "", els.recordType.value).length : 0;
  els.summaryMeta.textContent = text ? `${text.length} 字${metrics ? ` · ${metrics} 项指标` : ""}` : "等待识别内容";
  els.summaryEditStatus.textContent = state.summaryManuallyEdited ? "已手动修改 · 自动更新已暂停" : "模板自动生成";
}

function refreshSummary({ force = false, silent = false } = {}) {
  if (!force && state.summaryManuallyEdited) { updateSummaryMeta(); return; }
  const text = els.ocrText?.value.trim() || "";
  if (!text) {
    els.summaryText.value = "";
    updateSummaryMeta();
    return;
  }
  els.summaryText.value = buildSummaryByMode(text, els.recordType.value, state.summaryMode);
  state.summaryManuallyEdited = false;
  updateSummaryMeta();
  if (!silent) showToast(`已按“${els.summaryMode?.selectedOptions?.[0]?.textContent || "科研摘要"}”重建归纳`);
}

function updateSmartResult(text, autoApply = true) {
  const detection = detectDocumentType(`${els.recordTitle.value}\n${text}`);
  state.detectedType = detection.type;
  state.detectionReason = detection.reason;
  els.detectedType.textContent = detection.type ? `识别为：${detection.type}` : "等待识别资料类型";
  els.detectedReason.textContent = detection.reason;
  els.applyDetectedTypeButton.disabled = !detection.type;
  if (autoApply && detection.confident) els.recordType.value = detection.type;
  renderMetricTable(text, els.recordType.value);
  if (!state.summaryManuallyEdited) refreshSummary({ force: true, silent: true });
  else updateSummaryMeta();
}

function updatePersonDetection(text, autoApply = true) {
  const detection = detectPerson(text, state.ocrBlocks);
  state.detectedPersonName = detection.name;
  state.detectedPersonId = detection.personId;
  state.detectedPersonReason = detection.reason;
  els.detectedPerson.textContent = detection.confident ? `已识别：${[detection.name, detection.personId].filter(Boolean).join(" · ")}` : "未识别到个人信息";
  els.detectedPersonReason.textContent = detection.reason;
  els.applyDetectedPersonButton.disabled = !detection.confident;
  if (autoApply) {
    if (!els.personName.value.trim() && detection.name) els.personName.value = detection.name;
    if (!els.personId.value.trim() && detection.personId) els.personId.value = detection.personId;
    syncAutoStudyId();
  }
  renderQualitySummary(text);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(",");
  const mime = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片无法加载"));
    image.src = dataUrl;
  });
}

async function prepareImageForOcr(dataUrl) {
  const image = await loadImage(dataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const longestSide = Math.max(sourceWidth, sourceHeight);
  const targetLongestSide = Math.min(3600, Math.max(2200, longestSide));
  const scale = targetLongestSide / longestSide;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  // 手机拍电脑屏幕时会出现摩尔纹、暗角和低对比度；先轻度去屏闪，再做灰度拉伸。
  context.filter = "grayscale(1) contrast(1.24) brightness(1.04) blur(0.22px)";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  enhanceOcrPixels(context, canvas.width, canvas.height, "screen");
  return canvas.toDataURL("image/jpeg", 0.95);
}

function getHistogramPercentile(histogram, total, percentile) {
  const target = Math.max(0, Math.min(total - 1, Math.round(total * percentile)));
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative > target) return value;
  }
  return histogram.length - 1;
}

function enhanceOcrPixels(context, width, height, enhancement = "contrast") {
  let imageData;
  try { imageData = context.getImageData(0, 0, width, height); }
  catch { return; }
  const pixels = imageData.data;
  const total = width * height;
  const gray = new Uint8Array(total);
  const histogram = new Uint32Array(256);
  for (let index = 0; index < total; index += 1) {
    const offset = index * 4;
    const value = Math.round((pixels[offset] * 0.299) + (pixels[offset + 1] * 0.587) + (pixels[offset + 2] * 0.114));
    gray[index] = value;
    histogram[value] += 1;
  }
  const low = getHistogramPercentile(histogram, total, 0.015);
  const high = getHistogramPercentile(histogram, total, 0.985);
  const span = Math.max(24, high - low);
  let background = null;
  if (enhancement === "adaptive") {
    // 大范围模糊图作为局部背景，能抑制屏幕亮度不均和拍照阴影，再保留细小文字。
    const backgroundCanvas = document.createElement("canvas");
    backgroundCanvas.width = width;
    backgroundCanvas.height = height;
    const backgroundContext = backgroundCanvas.getContext("2d", { willReadFrequently: true });
    backgroundContext.filter = "blur(10px)";
    backgroundContext.drawImage(context.canvas, 0, 0);
    try { background = backgroundContext.getImageData(0, 0, width, height).data; }
    catch { background = null; }
  }
  for (let index = 0; index < total; index += 1) {
    const offset = index * 4;
    const stretched = clamp(Math.round(((gray[index] - low) * 255) / span), 0, 255);
    let value = stretched;
    if (background) {
      const localBackground = (background[offset] * 0.299) + (background[offset + 1] * 0.587) + (background[offset + 2] * 0.114);
      const delta = Math.max(18, Math.min(42, localBackground * 0.14));
      value = stretched < localBackground - delta ? 0 : 255;
    } else if (enhancement === "screen") {
      value = clamp(Math.round(128 + ((stretched - 128) * 1.10)), 0, 255);
    }
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function projectionGroups(values, threshold, maxGap) {
  const groups = [];
  let start = -1;
  let gap = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] >= threshold) {
      if (start < 0) start = index;
      gap = 0;
      continue;
    }
    if (start < 0) continue;
    gap += 1;
    if (gap > maxGap) {
      const end = index - gap;
      if (end >= start) groups.push({ start, end, score: values.slice(start, end + 1).reduce((sum, value) => sum + value, 0) });
      start = -1;
      gap = 0;
    }
  }
  if (start >= 0) {
    const end = values.length - 1 - gap;
    if (end >= start) groups.push({ start, end, score: values.slice(start, end + 1).reduce((sum, value) => sum + value, 0) });
  }
  return groups;
}

function detectContentCrop(image) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const previewWidth = Math.min(900, sourceWidth);
  const previewHeight = Math.max(1, Math.round(sourceHeight * previewWidth / sourceWidth));
  const canvas = document.createElement("canvas");
  canvas.width = previewWidth;
  canvas.height = previewHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, previewWidth, previewHeight);
  const pixels = context.getImageData(0, 0, previewWidth, previewHeight).data;
  const rowInk = new Float32Array(previewHeight);
  const colInk = new Float32Array(previewWidth);
  for (let y = 0; y < previewHeight; y += 1) {
    for (let x = 0; x < previewWidth; x += 1) {
      const offset = (y * previewWidth + x) * 4;
      const gray = (pixels[offset] * 0.299) + (pixels[offset + 1] * 0.587) + (pixels[offset + 2] * 0.114);
      if (gray < 188) {
        rowInk[y] += 1;
        colInk[x] += 1;
      }
    }
  }
  const rowGroups = projectionGroups(rowInk, Math.max(3, previewWidth * 0.0025), Math.max(4, Math.round(previewHeight * 0.018)));
  const row = rowGroups.sort((a, b) => (b.score * Math.sqrt(b.end - b.start + 1)) - (a.score * Math.sqrt(a.end - a.start + 1)))[0];
  if (!row) return null;
  const colGroups = projectionGroups(colInk, Math.max(3, previewHeight * 0.0025), Math.max(4, Math.round(previewWidth * 0.018)));
  const col = colGroups.sort((a, b) => (b.score * Math.sqrt(b.end - b.start + 1)) - (a.score * Math.sqrt(a.end - a.start + 1)))[0];
  if (!col) return null;
  const cropWidth = col.end - col.start + 1;
  const cropHeight = row.end - row.start + 1;
  if (cropWidth < previewWidth * 0.42 || cropHeight < previewHeight * 0.16) return null;
  const paddingX = Math.max(12, Math.round(previewWidth * 0.025));
  const paddingY = Math.max(12, Math.round(previewHeight * 0.025));
  const x = clamp(col.start - paddingX, 0, previewWidth - 1);
  const y = clamp(row.start - paddingY, 0, previewHeight - 1);
  const right = clamp(col.end + paddingX, x + 1, previewWidth - 1);
  const bottom = clamp(row.end + paddingY, y + 1, previewHeight - 1);
  const scaleX = sourceWidth / previewWidth;
  const scaleY = sourceHeight / previewHeight;
  const crop = {
    x: x * scaleX,
    y: y * scaleY,
    width: (right - x + 1) * scaleX,
    height: (bottom - y + 1) * scaleY,
  };
  const reduction = 1 - ((crop.width * crop.height) / (sourceWidth * sourceHeight));
  return reduction > 0.12 ? crop : null;
}

function detectBrightDocumentCrop(image) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const previewWidth = Math.min(1000, sourceWidth);
  const previewHeight = Math.max(1, Math.round(sourceHeight * previewWidth / sourceWidth));
  const canvas = document.createElement("canvas");
  canvas.width = previewWidth;
  canvas.height = previewHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, previewWidth, previewHeight);
  const pixels = context.getImageData(0, 0, previewWidth, previewHeight).data;
  const rowBright = new Float32Array(previewHeight);
  const colBright = new Float32Array(previewWidth);
  for (let y = 0; y < previewHeight; y += 1) {
    for (let x = 0; x < previewWidth; x += 1) {
      const offset = (y * previewWidth + x) * 4;
      const gray = (pixels[offset] * 0.299) + (pixels[offset + 1] * 0.587) + (pixels[offset + 2] * 0.114);
      // 报告页通常明显比显示器边框/黑色背景亮，允许轻微拍照阴影。
      if (gray > 158) {
        rowBright[y] += 1;
        colBright[x] += 1;
      }
    }
  }
  const rowGroups = projectionGroups(rowBright, previewWidth * 0.42, Math.max(8, Math.round(previewHeight * 0.025)));
  const colGroups = projectionGroups(colBright, previewHeight * 0.42, Math.max(8, Math.round(previewWidth * 0.025)));
  const row = rowGroups.filter((group) => group.end - group.start + 1 > previewHeight * 0.22)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  const col = colGroups.filter((group) => group.end - group.start + 1 > previewWidth * 0.42)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  if (!row || !col) return null;
  const paddingX = Math.max(10, Math.round(previewWidth * 0.012));
  const paddingY = Math.max(10, Math.round(previewHeight * 0.012));
  const x = clamp(col.start - paddingX, 0, previewWidth - 1);
  const y = clamp(row.start - paddingY, 0, previewHeight - 1);
  const right = clamp(col.end + paddingX, x + 1, previewWidth - 1);
  const bottom = clamp(row.end + paddingY, y + 1, previewHeight - 1);
  const scaleX = sourceWidth / previewWidth;
  const scaleY = sourceHeight / previewHeight;
  const crop = {
    x: x * scaleX,
    y: y * scaleY,
    width: (right - x + 1) * scaleX,
    height: (bottom - y + 1) * scaleY,
  };
  const reduction = 1 - ((crop.width * crop.height) / (sourceWidth * sourceHeight));
  return reduction > 0.06 ? crop : null;
}

function getOpenCv() {
  const candidate = window.cv;
  return candidate && typeof candidate.imread === "function" && typeof candidate.findContours === "function" && typeof candidate.warpPerspective === "function"
    ? candidate
    : null;
}

function distanceBetweenPoints(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function polygonArea(points) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + (point.x * next.y) - (next.x * point.y);
  }, 0) / 2);
}

function orderQuadrilateral(points) {
  if (!Array.isArray(points) || points.length !== 4) return null;
  const bySum = [...points].sort((first, second) => (first.x + first.y) - (second.x + second.y));
  const byDiff = [...points].sort((first, second) => (first.x - first.y) - (second.x - second.y));
  const ordered = [bySum[0], byDiff[3], bySum[3], byDiff[0]];
  const unique = new Set(ordered.map((point) => `${point.x},${point.y}`));
  return unique.size === 4 ? ordered : null;
}

function detectDocumentQuadrilateral(image) {
  const cv = getOpenCv();
  if (!cv) return null;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const previewWidth = Math.min(1200, sourceWidth);
  const previewHeight = Math.max(1, Math.round(sourceHeight * previewWidth / sourceWidth));
  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = previewWidth;
  previewCanvas.height = previewHeight;
  const context = previewCanvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, previewWidth, previewHeight);
  let source;
  let gray;
  let blurred;
  let edges;
  let contours;
  let hierarchy;
  try {
    source = cv.imread(previewCanvas);
    gray = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, 45, 140);
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const imageArea = previewWidth * previewHeight;
    let best = null;
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      let approx;
      try {
        const perimeter = cv.arcLength(contour, true);
        approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, Math.max(2, perimeter * 0.025), true);
        if (approx.rows !== 4) continue;
        const area = Math.abs(cv.contourArea(approx));
        if (area < imageArea * 0.28 || area > imageArea * 0.99) continue;
        const values = Array.from(approx.data32S || approx.data32F || []);
        if (values.length < 8) continue;
        const points = orderQuadrilateral([0, 1, 2, 3].map((pointIndex) => ({ x: values[pointIndex * 2], y: values[(pointIndex * 2) + 1] })));
        if (!points) continue;
        const width = Math.max(distanceBetweenPoints(points[0], points[1]), distanceBetweenPoints(points[3], points[2]));
        const height = Math.max(distanceBetweenPoints(points[0], points[3]), distanceBetweenPoints(points[1], points[2]));
        if (width < previewWidth * 0.40 || height < previewHeight * 0.25 || width / Math.max(1, height) > 8) continue;
        const score = area * Math.min(1, (width * height) / Math.max(1, area));
        if (!best || score > best.score) best = { points, score };
      } finally {
        approx?.delete();
        contour.delete();
      }
    }
    if (!best) return null;
    const scaleX = sourceWidth / previewWidth;
    const scaleY = sourceHeight / previewHeight;
    return {
      points: best.points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY })),
      sourceWidth,
      sourceHeight,
    };
  } catch {
    return null;
  } finally {
    source?.delete();
    gray?.delete();
    blurred?.delete();
    edges?.delete();
    contours?.delete();
    hierarchy?.delete();
  }
}

function invertHomography(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 9) return null;
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const determinant = (a * ((e * i) - (f * h))) - (b * ((d * i) - (f * g))) + (c * ((d * h) - (e * g)));
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) return null;
  return [
    ((e * i) - (f * h)) / determinant, ((c * h) - (b * i)) / determinant, ((b * f) - (c * e)) / determinant,
    ((f * g) - (d * i)) / determinant, ((a * i) - (c * g)) / determinant, ((c * d) - (a * f)) / determinant,
    ((d * h) - (e * g)) / determinant, ((b * g) - (a * h)) / determinant, ((a * e) - (b * d)) / determinant,
  ];
}

function applyHomography(matrix, point) {
  const denominator = (matrix[6] * point.x) + (matrix[7] * point.y) + matrix[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) return point;
  return {
    x: ((matrix[0] * point.x) + (matrix[1] * point.y) + matrix[2]) / denominator,
    y: ((matrix[3] * point.x) + (matrix[4] * point.y) + matrix[5]) / denominator,
  };
}

async function createRectifiedOcrVariant(image, page) {
  const cv = getOpenCv();
  const detected = detectDocumentQuadrilateral(image);
  if (!cv || !detected) return null;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const longestSide = Math.max(sourceWidth, sourceHeight);
  const workScale = Math.min(3600, Math.max(2200, longestSide)) / longestSide;
  const workWidth = Math.max(1, Math.round(sourceWidth * workScale));
  const workHeight = Math.max(1, Math.round(sourceHeight * workScale));
  const workCanvas = document.createElement("canvas");
  workCanvas.width = workWidth;
  workCanvas.height = workHeight;
  const workContext = workCanvas.getContext("2d", { willReadFrequently: true });
  workContext.imageSmoothingEnabled = true;
  workContext.imageSmoothingQuality = "high";
  workContext.drawImage(image, 0, 0, workWidth, workHeight);
  const sourcePoints = detected.points.map((point) => ({ x: point.x * workScale, y: point.y * workScale }));
  const targetWidth = Math.max(1, Math.round(Math.max(distanceBetweenPoints(sourcePoints[0], sourcePoints[1]), distanceBetweenPoints(sourcePoints[3], sourcePoints[2]))));
  const targetHeight = Math.max(1, Math.round(Math.max(distanceBetweenPoints(sourcePoints[0], sourcePoints[3]), distanceBetweenPoints(sourcePoints[1], sourcePoints[2]))));
  const outputScale = Math.min(1, 3400 / Math.max(targetWidth, targetHeight));
  const outputWidth = Math.max(1, Math.round(targetWidth * outputScale));
  const outputHeight = Math.max(1, Math.round(targetHeight * outputScale));
  let sourceMat;
  let sourcePointsMat;
  let targetPointsMat;
  let transform;
  let warped;
  try {
    sourceMat = cv.imread(workCanvas);
    sourcePointsMat = cv.matFromArray(4, 1, cv.CV_32FC2, sourcePoints.flatMap((point) => [point.x, point.y]));
    targetPointsMat = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outputWidth, 0, outputWidth, outputHeight, 0, outputHeight]);
    transform = cv.getPerspectiveTransform(sourcePointsMat, targetPointsMat);
    warped = new cv.Mat();
    cv.warpPerspective(sourceMat, warped, transform, new cv.Size(outputWidth, outputHeight), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
    const outputCanvas = document.createElement("canvas");
    cv.imshow(outputCanvas, warped);
    return {
      dataUrl: outputCanvas.toDataURL("image/jpeg", 0.97),
      page,
      label: "自动透视矫正·报告页",
      priority: 13,
      crop: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
      scaleX: outputWidth / sourceWidth,
      scaleY: outputHeight / sourceHeight,
      sourceWidth,
      sourceHeight,
      contentCrop: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
      inverseHomography: invertHomography(Array.from(transform.data64F || transform.data32F || [])),
      transformWorkScale: workScale,
    };
  } finally {
    sourceMat?.delete();
    sourcePointsMat?.delete();
    targetPointsMat?.delete();
    transform?.delete();
    warped?.delete();
  }
}

async function createOcrVariant(image, crop, label, priority, page, enhancement = "contrast") {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const targetLongestSide = Math.min(enhancement === "adaptive" ? 2600 : 3200, Math.max(1900, Math.max(crop.width, crop.height)));
  const scale = targetLongestSide / Math.max(crop.width, crop.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = enhancement === "screen"
    ? "grayscale(1) contrast(1.24) brightness(1.04) blur(0.22px)"
    : "grayscale(1) contrast(1.20) brightness(1.03)";
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  enhanceOcrPixels(context, canvas.width, canvas.height, enhancement);
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.97),
    page,
    label,
    priority,
    crop,
    scaleX: canvas.width / crop.width,
    scaleY: canvas.height / crop.height,
    sourceWidth,
    sourceHeight,
  };
}

async function getOcrVariants(dataUrl, page, { includeBase = true, includeFocused = true } = {}) {
  const image = await loadImage(dataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const full = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  // 先找报告页的亮区域，避免把手机状态栏、浏览器工具栏和显示器黑边送进 OCR。
  const reportCrop = detectBrightDocumentCrop(image);
  const content = reportCrop || detectContentCrop(image) || full;
  let rectified = null;
  try { rectified = await createRectifiedOcrVariant(image, page); } catch {}
  const variants = [];
  if (includeBase) {
    if (rectified) variants.push(rectified);
    else variants.push(await createOcrVariant(image, full, "整图·去屏闪", 0, page, "screen"));
    if (reportCrop) variants.push(await createOcrVariant(image, reportCrop, "报告页·去边框", 3, page, "screen"));
  }
  const headerHeight = Math.max(1, content.height * 0.42);
  const header = { ...content, height: headerHeight };
  if (includeBase) variants.push(await createOcrVariant(image, header, "表头·姓名和编号", 7, page, reportCrop ? "screen" : "contrast"));
  if (includeFocused) {
    const nameRegion = { ...content, width: Math.max(1, content.width * 0.74), height: Math.max(1, content.height * 0.38) };
    const idRegion = {
      // 本院手术记录的住院号可能换到下一行左侧，不能只截表头右半边。
      x: content.x + (content.width * 0.02),
      y: content.y,
      width: Math.max(1, content.width * 0.96),
      height: Math.max(1, content.height * 0.38),
    };
    variants.push(await createOcrVariant(image, nameRegion, "表头·姓名放大", 10, page, "adaptive"));
    variants.push(await createOcrVariant(image, idRegion, "表头·个人信息整栏", 11, page, "adaptive"));
    const bodyRegion = {
      x: content.x + (content.width * 0.025),
      y: content.y + (content.height * 0.16),
      width: Math.max(1, content.width * 0.95),
      height: Math.max(1, content.height * 0.80),
    };
    variants.push(await createOcrVariant(image, bodyRegion, "正文·去屏闪", 5, page, "screen"));
    variants.push(await createOcrVariant(image, bodyRegion, "正文·自适应增强", 4, page, "adaptive"));
    const isDifferent = Math.abs(content.x - full.x) > sourceWidth * 0.04
      || Math.abs(content.y - full.y) > sourceHeight * 0.04
      || Math.abs(content.width - full.width) > sourceWidth * 0.08
      || Math.abs(content.height - full.height) > sourceHeight * 0.08;
    if (isDifferent) {
      const detail = { ...content, y: content.y + content.height * 0.24, height: content.height * 0.76 };
      variants.push(await createOcrVariant(image, detail, "指标/正文区域", 6, page, "screen"));
    }
  }
  variants.forEach((variant) => { variant.contentCrop = content; });
  return variants;
}

function blockBounds(block) {
  if (!Array.isArray(block?.poly) || !block.poly.length) return null;
  const xs = block.poly.map((point) => point[0]);
  const ys = block.poly.map((point) => point[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y), right, bottom };
}

function intersectionOverUnion(first, second) {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.right, second.right);
  const bottom = Math.min(first.bottom, second.bottom);
  const area = Math.max(0, right - x) * Math.max(0, bottom - y);
  const union = (first.width * first.height) + (second.width * second.height) - area;
  return union ? area / union : 0;
}

function preferOcrBlock(candidate, current) {
  // 重点裁剪区只用于提高召回率，不能用优先级覆盖明显更高的识别置信度。
  const candidateScore = Number(candidate.score || 0) + (Number(candidate.variantPriority || 0) * 0.004);
  const currentScore = Number(current.score || 0) + (Number(current.variantPriority || 0) * 0.004);
  if (candidateScore !== currentScore) return candidateScore > currentScore;
  return String(candidate.text || "").length >= String(current.text || "").length;
}

function mergeOcrBlocks(blocks = []) {
  const sorted = blocks.filter((block) => block?.text?.trim() && blockBounds(block))
    .sort((a, b) => a.page - b.page || Number(b.variantPriority || 0) - Number(a.variantPriority || 0) || Number(b.score || 0) - Number(a.score || 0));
  const merged = [];
  sorted.forEach((candidate) => {
    const candidateBox = blockBounds(candidate);
    const duplicateIndex = merged.findIndex((current) => {
      if (Number(current.page || 0) !== Number(candidate.page || 0)) return false;
      const currentBox = blockBounds(current);
      const iou = intersectionOverUnion(candidateBox, currentBox);
      const heightRatio = Math.min(candidateBox.height, currentBox.height) / Math.max(candidateBox.height, currentBox.height);
      return iou >= 0.52 && heightRatio >= 0.55;
    });
    if (duplicateIndex < 0) merged.push(candidate);
    else if (preferOcrBlock(candidate, merged[duplicateIndex])) merged[duplicateIndex] = candidate;
  });
  return merged.sort((a, b) => a.page - b.page || (blockBounds(a)?.y || 0) - (blockBounds(b)?.y || 0) || (blockBounds(a)?.x || 0) - (blockBounds(b)?.x || 0));
}

function mapOcrItemToSource(item, variant) {
  const poly = Array.isArray(item.poly) ? item.poly.map((point) => {
    if (variant.inverseHomography) {
      const sourcePoint = applyHomography(variant.inverseHomography, { x: point[0], y: point[1] });
      return [sourcePoint.x / Math.max(0.0001, variant.transformWorkScale || 1), sourcePoint.y / Math.max(0.0001, variant.transformWorkScale || 1)];
    }
    return [variant.crop.x + (point[0] / variant.scaleX), variant.crop.y + (point[1] / variant.scaleY)];
  }) : [];
  return { ...item, poly, page: variant.page, variant: variant.label, variantPriority: variant.priority, contentCrop: variant.contentCrop };
}

function buildOcrTextFromBlocks(blocks) {
  const lines = groupOcrBlocksIntoLines(blocks);
  let currentPage = null;
  const output = [];
  lines.forEach((line) => {
    const page = Number.isFinite(Number(line.page)) ? Number(line.page) : null;
    if (page !== null && page !== currentPage) {
      if (output.length) output.push("");
      output.push(`【第 ${page + 1} 张图片】`);
      currentPage = page;
    }
    if (line.text) output.push(line.text);
  });
  return output.join("\n");
}

async function getOcrImages() {
  const prepared = [];
  for (let index = 0; index < state.images.length; index += 1) {
    els.processingDetail.textContent = `正在增强第 ${index + 1}/${state.images.length} 张图片：放大、灰度和对比度优化`;
    try { prepared.push(await prepareImageForOcr(state.images[index].dataUrl)); }
    catch { prepared.push(state.images[index].dataUrl); }
  }
  return prepared;
}

async function getPaddleOcr() {
  if (state.paddleOcr) return state.paddleOcr;
  if (state.paddleOcrPromise) return state.paddleOcrPromise;
  state.paddleOcrPromise = loadPaddleOcrModule()
    .then(async ({ PaddleOCR }) => {
      if (!PaddleOCR) throw new Error("PaddleOCR.js module did not expose PaddleOCR");
      await verifyPaddleAssets();
      state.paddleOcr = await PaddleOCR.create({
        textDetectionModelName: "PP-OCRv6_small_det",
        textDetectionModelAsset: PADDLE_MODEL_ASSETS.det,
        textRecognitionModelName: "PP-OCRv6_small_rec",
        textRecognitionModelAsset: PADDLE_MODEL_ASSETS.rec,
        textDetectionBatchSize: 1,
        textRecognitionBatchSize: 4,
        ortOptions: {
          backend: "wasm",
          wasmPaths: PADDLE_WASM_PATH,
          numThreads: 1,
          simd: true,
          proxy: false,
        },
      });
      return state.paddleOcr;
    })
    .finally(() => { state.paddleOcrPromise = null; });
  return state.paddleOcrPromise;
}

async function verifyPaddleAssets() {
  const checks = [
    [PADDLE_MODEL_ASSETS.det.url, "检测模型"],
    [PADDLE_MODEL_ASSETS.rec.url, "PP-OCRv6 识别模型"],
    [`${PADDLE_WASM_PATH}ort-wasm-simd-threaded.mjs`, "WASM 运行时"],
    [`${PADDLE_WASM_PATH}ort-wasm-simd-threaded.wasm`, "WASM 文件"],
  ];
  for (const [url, label] of checks) {
    els.processingDetail.textContent = `检查${label}：${url}`;
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!response.ok) throw new Error(`${label}不可访问（HTTP ${response.status}）：${url}`);
  }
}

function predictPaddleWithTimeout(ocr, sources, params = {}, timeoutMs = PADDLE_PREDICT_TIMEOUT_MS, onTick = () => {}) {
  let timer;
  const startedAt = Date.now();
  const ticker = setInterval(() => onTick(Math.round((Date.now() - startedAt) / 1000)), 1000);
  const prediction = Promise.resolve().then(() => ocr.predict(sources, params));
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => { clearInterval(ticker); reject(new Error(`PaddleOCR 单区域识别超过 ${Math.round(timeoutMs / 1000)} 秒，已停止等待`)); }, timeoutMs);
    prediction.then(resolve, reject).finally(() => { clearTimeout(timer); clearInterval(ticker); });
  });
}

async function loadPaddleOcrModule() {
  const sources = [
    new URL("./vendor/paddleocr-js/dist/index.mjs", document.baseURI).href,
  ];
  let lastError;
  for (const source of sources) {
    try {
      els.processingDetail.textContent = `正在加载 PaddleOCR 浏览器 SDK：${new URL(source).hostname}`;
      return await Promise.race([
        import(source),
        new Promise((_, reject) => setTimeout(() => reject(new Error("SDK 加载超过 20 秒")), 20000)),
      ]);
    }
    catch (error) { lastError = error; }
  }
  throw new Error(`PaddleOCR.js 模块加载失败：${lastError?.message || "网络或浏览器模块限制"}`);
}

function filterPaddleBlocks(results) {
  const rawBlocks = [];
  results.forEach(({ result, variant }) => {
    (result.items || []).forEach((item) => rawBlocks.push(mapOcrItemToSource(item, variant)));
  });
  return mergeOcrBlocks(rawBlocks).filter((block) => {
    const crop = block.contentCrop;
    const box = blockBounds(block);
    if (!crop || !box) return true;
    // 去掉报告上方的手机状态栏、文件名和下方的浏览器/查看器工具栏。
    const centerY = box.y + (box.height / 2);
    const centerX = box.x + (box.width / 2);
    const xPadding = Math.max(18, crop.width * 0.035);
    const yPadding = Math.max(18, crop.height * 0.035);
    return centerX >= crop.x - xPadding
      && centerX <= crop.x + crop.width + xPadding
      && centerY >= crop.y - yPadding
      && centerY <= crop.y + crop.height + yPadding;
  });
}

async function runPaddleVariants(ocr, variants, results, progressStart, progressEnd, stageLabel) {
  for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
    const variant = variants[variantIndex];
    const progress = progressStart + Math.round((variantIndex / variants.length) * (progressEnd - progressStart));
    els.processingPercent.textContent = `${progress}%`;
    els.processingDetail.textContent = `${stageLabel}：${variantIndex + 1}/${variants.length} · ${variant.label}`;
    const batch = await predictPaddleWithTimeout(
      ocr,
      [dataUrlToBlob(variant.dataUrl)],
      // 表头小字和屏幕拍照后的字符置信度偏低，优先保证姓名/住院号召回率，后续仍需人工复核。
      { textRecScoreThresh: Number(variant.priority || 0) >= 7 ? 0.14 : 0.18 },
      PADDLE_PREDICT_TIMEOUT_MS,
      (seconds) => { els.processingDetail.textContent = `${stageLabel}：${variantIndex + 1}/${variants.length} · ${variant.label}（已用 ${seconds} 秒）`; },
    );
    const result = Array.isArray(batch) ? batch[0] : batch;
    results.push({ result: result || {}, variant });
    els.processingPercent.textContent = `${progressStart + Math.round(((variantIndex + 1) / variants.length) * (progressEnd - progressStart))}%`;
  }
}

async function recognizeWithPaddle() {
  els.processingTitle.textContent = "加载 PaddleOCR PP-OCRv6 small…";
  els.processingDetail.textContent = "首次运行检查项目内置的中文检测模型、识别模型和 WASM 运行时";
  els.processingPercent.textContent = "15%";
  const ocr = await getPaddleOcr();
  els.processingTitle.textContent = `快速识别 ${state.images.length} 张图片…`;
  els.processingDetail.textContent = "先识别整图和表头，只有必要时才补跑放大区域";
  els.processingPercent.textContent = "30%";
  const baseVariants = [];
  for (let index = 0; index < state.images.length; index += 1) {
    try {
      const pageVariants = await getOcrVariants(state.images[index].dataUrl, index, { includeFocused: false });
      baseVariants.push(...pageVariants);
      els.processingDetail.textContent = `第 ${index + 1}/${state.images.length} 张已生成快速识别区域`;
    } catch (error) {
      const fallback = await prepareImageForOcr(state.images[index].dataUrl);
      baseVariants.push({ dataUrl: fallback, page: index, label: "整图", priority: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, scaleX: 1, scaleY: 1 });
    }
  }
  const results = [];
  try {
    await runPaddleVariants(ocr, baseVariants, results, 45, 70, "快速识别");
    let blocks = filterPaddleBlocks(results);
    const labThreshold = els.recordType.value === "血常规" ? 12 : 4;
    const weakPages = [];
    for (let index = 0; index < state.images.length; index += 1) {
      const pageBlocks = blocks.filter((block) => Number(block.page) === index);
      const pageText = buildOcrTextFromBlocks(pageBlocks);
      const pagePerson = detectPerson(pageText, pageBlocks);
      const pageType = detectDocumentType(pageText);
      const pageMetrics = labFieldRules[els.recordType.value] ? extractAllLabRows(pageText, pageBlocks) : [];
      const identityMissing = !pagePerson.name && !pagePerson.personId;
      const metricsMissing = Boolean(labFieldRules[els.recordType.value]) && pageMetrics.length < labThreshold;
      const textDocument = ["手术记录", "住院病历", "门诊病历", "出院小结", "病理报告"].includes(pageType.type);
      // 长段落病历即使识别出了姓名，也可能漏掉术中所见；短文本/块数少时补跑正文增强区域。
      const textBodyWeak = textDocument && (pageText.replace(/\s/g, "").length < 900 || pageBlocks.length < 28);
      if (identityMissing || metricsMissing || textBodyWeak) weakPages.push(index);
    }
    if (weakPages.length) {
      const focusedVariants = [];
      for (const index of weakPages) {
        try {
          const pageVariants = await getOcrVariants(state.images[index].dataUrl, index, { includeBase: false, includeFocused: true });
          focusedVariants.push(...pageVariants);
        } catch {}
      }
      if (focusedVariants.length) {
        els.processingDetail.textContent = `第 ${weakPages.map((index) => index + 1).join("、")} 张图片需要加强识别，补跑 ${focusedVariants.length} 个重点区域`;
        await runPaddleVariants(ocr, focusedVariants, results, 70, 90, "重点区域");
        blocks = filterPaddleBlocks(results);
      }
    }
    els.processingPercent.textContent = "90%";
    return { text: buildOcrTextFromBlocks(blocks), blocks };
  } catch (error) {
    if (String(error?.message || "").includes("超过")) {
      try { await ocr.dispose?.(); } catch {}
      state.paddleOcr = null;
    }
    throw error;
  }
}

async function recognizeWithTesseract() {
  if (!window.Tesseract) throw new Error("Tesseract fallback is unavailable");
  els.processingTitle.textContent = "正在使用备用 OCR…";
  els.processingDetail.textContent = "PaddleOCR 未能初始化，当前使用 Tesseract.js 完成识别";
  els.processingPercent.textContent = "20%";
  const worker = await Tesseract.createWorker("chi_sim+eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text") {
        const percent = Math.round((message.progress || 0) * 100);
        els.processingPercent.textContent = `${percent}%`;
      } else if (message.status) {
        els.processingDetail.textContent = message.status;
      }
    },
  });
  const ocrImages = await getOcrImages();
  let combined = "";
  const blocks = [];
  for (let index = 0; index < ocrImages.length; index += 1) {
    const result = await worker.recognize(ocrImages[index]);
    if (result.data.text.trim()) combined += `${combined ? "\n\n" : ""}${result.data.text.trim()}`;
    (result.data.words || []).forEach((word) => {
      const text = word.text?.trim();
      const bbox = word.bbox;
      if (!text || !bbox) return;
      blocks.push({
        text,
        score: Math.max(0, Math.min(1, Number(word.confidence ?? 0) / 100)),
        poly: [[bbox.x0, bbox.y0], [bbox.x1, bbox.y0], [bbox.x1, bbox.y1], [bbox.x0, bbox.y1]],
        page: index,
      });
    });
  }
  await worker.terminate();
  return { text: combined, blocks };
}

async function addFiles(files) {
  const imageFiles = [...files].filter((file) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name || ""));
  if (!imageFiles.length) return;
  state.imagesLoading = true;
  renderPreviews();
  const additions = [];
  for (const file of imageFiles) {
    try { additions.push({ dataUrl: await fileToDataUrl(file), name: file.name || "camera.jpg" }); }
    catch { showToast(`读取图片失败：${file.name || "未命名图片"}`, "error"); }
  }
  state.images.push(...additions);
  state.imagesLoading = false;
  renderPreviews();
  showToast(`已添加 ${additions.length}/${imageFiles.length} 张图片`);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("当前浏览器不支持相机，请从相册导入", "error");
    return;
  }
  if (state.screenStream) stopScreenScan();
  try {
    const selectedDeviceId = els.cameraDeviceSelect?.value || state.cameraDeviceId || "";
    const videoConstraints = selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : { facingMode: { ideal: "environment" } };
    state.stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    const trackSettings = state.stream.getVideoTracks()[0]?.getSettings?.() || {};
    if (trackSettings.deviceId) state.cameraDeviceId = trackSettings.deviceId;
    await refreshCameraDevices();
    if (state.cameraDeviceId && els.cameraDeviceSelect) els.cameraDeviceSelect.value = state.cameraDeviceId;
    els.cameraVideo.srcObject = state.stream;
    els.cameraVideo.hidden = false;
    els.cameraPlaceholder.hidden = true;
    els.takePhotoButton.disabled = false;
    els.takePhotoButton.innerHTML = '<span class="button-icon">＋</span>拍一张';
    els.startCameraButton.textContent = "关闭相机";
    els.startCameraButton.dataset.open = "true";
  } catch {
    showToast("无法打开相机，请检查浏览器权限", "error");
  }
}

async function refreshCameraDevices() {
  if (!els.cameraDeviceSelect || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.cameraDevices = devices.filter((device) => device.kind === "videoinput");
    const options = state.cameraDevices.map((device, index) => {
      const label = device.label || `摄像头 ${index + 1}`;
      return `<option value="${escapeHtml(device.deviceId)}">${escapeHtml(label)}</option>`;
    }).join("");
    els.cameraDeviceSelect.innerHTML = `<option value="">系统默认摄像头</option>${options}`;
    if (state.cameraDeviceId && state.cameraDevices.some((device) => device.deviceId === state.cameraDeviceId)) els.cameraDeviceSelect.value = state.cameraDeviceId;
    return state.cameraDevices;
  } catch {
    return [];
  }
}

function stopCamera() {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  els.cameraVideo.srcObject = null;
  els.cameraVideo.hidden = true;
  els.cameraPlaceholder.hidden = false;
  els.takePhotoButton.disabled = true;
  els.takePhotoButton.innerHTML = '<span class="button-icon">＋</span>拍一张';
  els.startCameraButton.textContent = "开启相机";
  delete els.startCameraButton.dataset.open;
}

async function startScreenScan() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast("当前浏览器不支持扫描电脑页面，请使用最新版 Chrome 或 Edge", "error");
    return;
  }
  if (state.stream) stopCamera();
  try {
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const [track] = state.screenStream.getVideoTracks();
    track?.addEventListener("ended", stopScreenScan, { once: true });
    els.cameraVideo.srcObject = state.screenStream;
    els.cameraVideo.hidden = false;
    els.cameraPlaceholder.hidden = true;
    els.takePhotoButton.disabled = false;
    els.takePhotoButton.innerHTML = '<span class="button-icon">▣</span>截取页面';
    els.scanScreenButton.textContent = "结束扫描页面";
    els.scanScreenButton.dataset.open = "true";
    showToast("已连接电脑页面，请选择病历页面后点击“截取页面”");
  } catch (error) {
    state.screenStream = null;
    if (error?.name !== "NotAllowedError") showToast("无法读取电脑页面，请重新授权屏幕共享", "error");
  }
}

function stopScreenScan() {
  const stream = state.screenStream;
  state.screenStream = null;
  stream?.getTracks().forEach((track) => track.stop());
  if (!state.stream) {
    els.cameraVideo.srcObject = null;
    els.cameraVideo.hidden = true;
    els.cameraPlaceholder.hidden = false;
    els.takePhotoButton.disabled = true;
  }
  els.takePhotoButton.innerHTML = '<span class="button-icon">＋</span>拍一张';
  els.scanScreenButton.textContent = "扫描电脑页面";
  delete els.scanScreenButton.dataset.open;
}

function takePhoto() {
  const captureStream = state.stream || state.screenStream;
  if (!captureStream) return;
  const video = els.cameraVideo;
  const canvas = els.captureCanvas;
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 960;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  const prefix = state.screenStream ? "screen" : "camera";
  state.images.push({ dataUrl: canvas.toDataURL("image/jpeg", .92), name: `${prefix}-${Date.now()}.jpg` });
  renderPreviews();
  showToast(state.screenStream ? "已截取电脑页面 1 张" : "已拍摄 1 张图片");
}

function resetCapture({ preserveCase = false } = {}) {
  const preservedCase = preserveCase ? {
    personName: els.personName.value,
    personId: els.personId.value,
    appendicitisEnabled: els.appendicitisEnabled?.checked !== false,
    continueCaseAfterArchive: els.continueCaseAfterArchive?.checked !== false,
    appendicitisData: getAppendicitisDataFromForm(),
  } : null;
  state.images = [];
  state.ocrText = "";
  state.detectedType = "";
  state.detectionReason = "";
  state.detectedPersonName = "";
  state.detectedPersonId = "";
  state.detectedPersonReason = "";
  state.summaryManuallyEdited = false;
  state.ocrEngine = "";
  state.ocrBlocks = [];
  state.ocrEdited = false;
  state.ocrOriginalText = "";
  state.ocrError = "";
  state.currentMetrics = [];
  state.metricSourceRows = [];
  state.batchAudit = null;
  state.appendicitisData = {};
  els.personName.value = "";
  els.personId.value = "";
  els.recordTitle.value = "";
  els.recordNote.value = "";
  if (els.appendicitisEnabled) els.appendicitisEnabled.checked = true;
  if (els.appendicitisCapture) els.appendicitisCapture.hidden = false;
  applyAppendicitisData({});
  syncAutoStudyId();
  els.ocrText.value = "";
  els.summaryText.value = "";
  if (els.reviewConfirmed) els.reviewConfirmed.checked = false;
  els.metricTableWrap.hidden = true;
  els.metricTableBody.innerHTML = "";
  els.detectedType.textContent = "等待识别资料类型";
  els.detectedReason.textContent = "OCR 完成后将根据关键词自动判断";
  els.applyDetectedTypeButton.disabled = true;
  els.detectedPerson.textContent = "等待识别个人";
  els.detectedPersonReason.textContent = "将从姓名、住院号、门诊号或病案号中提取个人信息";
  els.applyDetectedPersonButton.disabled = true;
  if (els.qualitySummary) {
    els.qualitySummary.hidden = true;
    els.qualitySummary.dataset.state = "ok";
  }
  setOcrEditor(false);
  setOcrStatus("待处理");
  renderPreviews();
  clearCaptureDraft();
  if (els.appendicitisDraftStatus) els.appendicitisDraftStatus.textContent = "填写即保存草稿";
  if (preservedCase) {
    els.personName.value = preservedCase.personName;
    els.personId.value = preservedCase.personId;
    els.appendicitisEnabled.checked = preservedCase.appendicitisEnabled;
    els.continueCaseAfterArchive.checked = preservedCase.continueCaseAfterArchive;
    els.appendicitisCapture.hidden = !preservedCase.appendicitisEnabled;
    applyAppendicitisData(preservedCase.appendicitisData);
    saveCaptureDraft();
  }
  updatePatientMatchHint();
}

async function recognizeImages() {
  if (!state.images.length || state.ocrBusy || state.imagesLoading) return;
  const selectedEngine = els.ocrEngineSelect?.value || "auto";
  state.ocrBusy = true;
  state.ocrError = "";
  setOcrEditor(true);
  setOcrStatus("正在识别", true);
  els.processingBar.hidden = false;
  els.processingTitle.textContent = "正在识别图片…";
  els.processingDetail.textContent = selectedEngine === "tesseract"
    ? "本次固定使用 Tesseract.js，不会切换到其他引擎"
    : selectedEngine === "paddle"
      ? "本次固定使用 PaddleOCR PP-OCRv6 small，失败后会显示错误"
      : "自动模式：优先 PaddleOCR PP-OCRv6 small，失败后使用 Tesseract.js";
  els.archiveButton.disabled = true;
  els.reRecognizeButton.disabled = true;
  if (els.reviewConfirmed) els.reviewConfirmed.checked = false;
  els.ocrText.value = "";
  let combined = "";
  try {
    if (selectedEngine === "tesseract") {
      const tesseractResult = await recognizeWithTesseract();
      combined = tesseractResult.text;
      state.ocrBlocks = tesseractResult.blocks;
      state.ocrEngine = "Tesseract.js（手动选择）";
    } else if (selectedEngine === "paddle") {
      const paddleResult = await recognizeWithPaddle();
      combined = paddleResult.text;
      state.ocrBlocks = paddleResult.blocks;
      state.ocrEngine = "PaddleOCR PP-OCRv6 small";
    } else {
      try {
        const paddleResult = await recognizeWithPaddle();
        combined = paddleResult.text;
        state.ocrBlocks = paddleResult.blocks;
      state.ocrEngine = "PaddleOCR PP-OCRv6 small";
      } catch (paddleError) {
        console.warn("PaddleOCR initialization or recognition failed; using Tesseract fallback.", paddleError);
        const tesseractResult = await recognizeWithTesseract();
        combined = tesseractResult.text;
        state.ocrBlocks = tesseractResult.blocks;
        state.ocrEngine = "Tesseract.js（自动备用）";
        showToast("PaddleOCR 未能初始化，已自动切换 Tesseract.js；可改为固定引擎继续对比", "error");
      }
    }
    state.ocrText = combined;
    state.ocrOriginalText = combined;
    state.ocrEdited = false;
    els.ocrText.value = combined;
    state.summaryManuallyEdited = false;
    updateSmartResult(combined, true);
    updatePersonDetection(combined, true);
    applyAutoAppendicitisFields(combined, els.recordType.value);
    renderNumbers(combined);
    setOcrStatus(`识别完成 · ${state.ocrEngine.replace("（自动备用）", "")} · ${state.images.length} 张图片`, false);
    els.processingBar.hidden = true;
    showToast(`${state.ocrEngine} 已完成 ${state.images.length} 张图片，请人工校对后归档`);
  } catch (error) {
    console.error(error);
    state.ocrError = String(error?.message || error || "未知错误").replace(/\s+/g, " ").slice(0, 220);
    els.processingBar.hidden = false;
    setOcrStatus("识别失败", false);
    els.processingTitle.textContent = `${state.ocrEngine || "PaddleOCR"} 加载/识别失败`;
    els.processingDetail.textContent = state.ocrError;
    els.processingPercent.textContent = "!";
    els.detectedPerson.textContent = "OCR 失败，暂无法提取个人信息";
    els.detectedPersonReason.textContent = "请根据上方错误信息检查本地模型资源、浏览器缓存或网络模块加载状态";
    els.applyDetectedPersonButton.disabled = true;
    showToast(`${state.ocrEngine || "OCR"} 失败：${state.ocrError}`, "error");
  } finally {
    state.ocrBusy = false;
    els.archiveButton.disabled = false;
    els.reRecognizeButton.disabled = false;
    renderPreviews();
  }
}

function getRecordNumbers(text) {
  const numbers = text.match(/[-+]?\d+(?:[.,]\d+)?(?:\s?(?:mg|g|mmol\/L|μmol\/L|mmHg|℃|%|次\/分|mL|片|粒|天|岁))?/gi) || [];
  return [...new Set(numbers.map((item) => item.trim()))].slice(0, 30);
}

function validateStudyInclusion(data = getAppendicitisDataFromForm()) {
  if (els.appendicitisEnabled?.checked === false) return { ok: false, message: "请先启用阑尾炎病例采集，才能按研究方案归档" };
  if (!String(data.study_id || "").trim()) return { ok: false, message: "请填写 study_id；同一 index episode 的多份资料必须使用同一个研究编号" };
  const indexEpisode = String(data.index_episode || "").trim();
  if (!indexEpisode) return { ok: false, message: "请先选择是否为纳入的 index episode；重复住院/重复发作请排除并填写原因" };
  if (["否", "重复住院/重复发作"].includes(indexEpisode) && !String(data.exclusion_reason || "").trim()) return { ok: false, message: "当前病例已标记为非 index episode，请填写排除原因后归档筛选记录" };
  return { ok: true };
}

function getStudyInclusionStatus(data = {}) {
  if (!String(data.study_id || "").trim()) return "待补录：study_id";
  const indexEpisode = String(data.index_episode || "").trim();
  if (["否", "重复住院/重复发作"].includes(indexEpisode)) return "不纳入：非 index episode";
  if (!indexEpisode || ["不确定", "未记录"].includes(indexEpisode)) return "待判定：index episode";
  const exploration = String(data.laparoscopy_exploration || "").trim();
  const appendectomyAttempted = String(data.appendectomy_attempted || "").trim();
  if (exploration === "无") return "不纳入：未接受腹腔镜探查";
  if (appendectomyAttempted === "无") return "不纳入：未尝试阑尾切除";
  if (exploration !== "有" || appendectomyAttempted !== "有") return "待补录：腹腔镜探查/阑尾切除尝试";
  const primaryOutcome = String(data.perforation_primary || "").trim();
  if (["是", "有"].includes(primaryOutcome)) return "纳入研究队列｜主要结局：穿孔";
  if (["否", "无"].includes(primaryOutcome)) return "纳入研究队列｜主要结局：未穿孔";
  return "纳入研究队列｜主要结局待补录";
}

function getStudyIdOrigin(data = {}, personName = "", personId = "") {
  const studyId = String(data.study_id || "").trim();
  if (!studyId) return "未设置";
  const idGenerated = `CASE-${getStableResearchHash(`id:${normalizeIdentityToken(personId)}`)}`;
  const nameGenerated = `CASE-${getStableResearchHash(`name:${normalizeIdentityToken(personName)}`)}`;
  if (personId && studyId === idGenerated) return "由病案/就诊号自动生成";
  if (!personId && personName && studyId === nameGenerated) return "由姓名自动生成（缺少编号，需确认）";
  return "人工研究编号";
}

function getPatientIdentityQuality(patient) {
  const ids = [...new Set(patient.records.map((record) => normalizeIdentityToken(record.personId)).filter(Boolean))];
  if (ids.length > 1) return "身份冲突";
  if (ids.length === 1) return "病案/就诊号匹配";
  return patient.records.some((record) => record.personName) ? "仅姓名匹配，建议补编号" : "待确认身份";
}

function focusResearchInclusion() {
  if (els.appendicitisEnabled) els.appendicitisEnabled.checked = true;
  if (els.appendicitisCapture) els.appendicitisCapture.hidden = false;
  const group = els.appendicitisForm?.querySelector('[data-appendicitis-group="basic"]');
  if (group) {
    group.open = true;
    group.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function archiveCurrent() {
  const text = els.ocrText.value.trim();
  if (!state.images.length) { showToast("请先拍照或导入图片", "error"); return; }
  if (!text) { showToast("请先完成识别，或在识别结果中手动录入内容", "error"); return; }
  if (!els.reviewConfirmed?.checked) {
    showToast("请先核对姓名/编号、指标结果、单位和参考范围", "error");
    els.reviewConfirmed?.focus();
    return;
  }
  const personName = els.personName.value.trim();
  const personId = els.personId.value.trim();
  if (!personName && !personId) { showToast("请填写个人/患者姓名或病案/就诊号，资料才能按个人归档", "error"); els.personName.focus(); return; }
  const identityIssue = getPatientIdentityIssue(personName, personId);
  if (identityIssue) {
    showToast(identityIssue, "error");
    els.personId.focus();
    updatePatientMatchHint();
    return;
  }
  const batchAudit = getBatchIdentityAudit(text, state.ocrBlocks);
  if (batchAudit.identityConflict) {
    showToast("检测到多张图片中的姓名或编号不一致，请先拆分资料或核对患者身份", "error");
    renderQualitySummary(text);
    return;
  }
  if (batchAudit.mixedTypes) {
    showToast(`同一批图片包含${batchAudit.types.join("、")}，请按同一份资料分批识别归档`, "error");
    renderQualitySummary(text);
    return;
  }
  syncAutoStudyId();
  const appendicitisData = getAppendicitisDataFromForm();
  const inclusion = validateStudyInclusion(appendicitisData);
  if (!inclusion.ok) {
    showToast(inclusion.message, "error");
    focusResearchInclusion();
    return;
  }
  const now = new Date();
  const metrics = labFieldRules[els.recordType.value] ? getEditableMetricRows() : [];
  const summary = els.summaryText.value.trim() || buildSummary(text, els.recordType.value);
  const record = {
    id: makeId(),
    personName,
    personId,
    patientKey: resolvePatientKey(personName, personId),
    title: els.recordTitle.value.trim() || `${els.recordType.value} · ${now.toLocaleDateString("zh-CN")}`,
    type: els.recordType.value,
    note: els.recordNote.value.trim(),
    text,
    ocrEdited: state.ocrEdited,
    ocrOriginalText: state.ocrOriginalText || text,
    summary,
    detectedType: state.detectedType,
    ocrEngine: state.ocrEngine,
    studyIdOrigin: getStudyIdOrigin(appendicitisData, personName, personId),
    batchAudit,
    metrics,
    numbers: getRecordNumbers(text),
    images: state.images.map((image) => image.dataUrl),
    appendicitisData,
    reviewConfirmed: true,
    reviewStatus: "人工已复核",
    reviewedAt: now.getTime(),
    createdAt: now.getTime(),
  };
  try {
    await saveRecord(record);
    state.records.unshift(record);
    renderRecords();
    updateStorageStatus();
    const continueCase = Boolean(els.continueCaseAfterArchive?.checked);
    resetCapture({ preserveCase: continueCase });
    showToast(continueCase ? "资料已归档，已保留当前病例信息，可继续拍下一份资料" : "资料已归档到本机");
  } catch (error) {
    console.error(error);
    showToast("保存失败，可能是设备存储空间不足", "error");
  }
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function normalizeIdentityToken(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\s\u3000]/g, "")
    .replace(/[·•．。]/g, "")
    .replace(/[—–\-_/:：]/g, "")
    .toLowerCase()
    .trim();
}

function getPatientIdentityMatches(personName = "", personId = "", records = state.records) {
  const nameToken = normalizeIdentityToken(personName);
  const idToken = normalizeIdentityToken(personId);
  const source = Array.isArray(records) ? records : [];
  const idMatches = idToken
    ? source.filter((record) => normalizeIdentityToken(record.personId) === idToken)
    : [];
  const nameMatches = nameToken
    ? source.filter((record) => normalizeIdentityToken(record.personName) === nameToken)
    : [];
  const uniqueIds = [...new Set(nameMatches.map((record) => normalizeIdentityToken(record.personId)).filter(Boolean))];
  return { nameToken, idToken, idMatches, nameMatches, uniqueIds };
}

function getCanonicalPatientKey(record, records = state.records) {
  const matches = getPatientIdentityMatches(record?.personName, record?.personId, records);
  if (matches.idToken) return `id:${matches.idToken}`;
  if (matches.uniqueIds.length === 1) return `id:${matches.uniqueIds[0]}`;
  if (matches.nameToken) return `name:${matches.nameToken}`;
  return "unassigned";
}

function resolvePatientKey(personName = "", personId = "", records = state.records) {
  return getCanonicalPatientKey({ personName, personId }, records);
}

function getPatientIdentityIssue(personName = "", personId = "", records = state.records) {
  const matches = getPatientIdentityMatches(personName, personId, records);
  if (!matches.idToken && matches.nameToken && matches.uniqueIds.length > 1) {
    return "发现同名但对应多个病案/住院号，请补填并核对编号后再归档，系统不会自动合并。";
  }
  return "";
}

function ensurePatientMatchHint() {
  if (els.patientMatchHint) return els.patientMatchHint;
  const field = els.personId?.closest(".field");
  if (!field) return null;
  const hint = document.createElement("small");
  hint.id = "patientMatchHint";
  hint.className = "patient-match-hint";
  hint.hidden = true;
  field.appendChild(hint);
  els.patientMatchHint = hint;
  return hint;
}

function updatePatientMatchHint() {
  const hint = ensurePatientMatchHint();
  if (!hint) return;
  const personName = els.personName?.value.trim() || "";
  const personId = els.personId?.value.trim() || "";
  if (!personName && !personId) {
    hint.hidden = true;
    hint.textContent = "";
    return;
  }
  const matches = getPatientIdentityMatches(personName, personId);
  hint.hidden = false;
  hint.dataset.state = "new";
  if (matches.idMatches.length) {
    const matched = matches.idMatches.find((record) => record.personName) || matches.idMatches[0];
    hint.dataset.state = "match";
    hint.textContent = `编号已匹配已有个人：${matched.personName || "未命名"}；本份资料将归入同一档案`;
    return;
  }
  if (!matches.idToken && matches.uniqueIds.length === 1) {
    const matched = matches.nameMatches.find((record) => record.personId) || matches.nameMatches[0];
    hint.dataset.state = "match";
    hint.textContent = `按姓名匹配到已有个人：${matched.personName || personName}；建议补填病案/住院号确认`;
    return;
  }
  if (!matches.idToken && matches.uniqueIds.length > 1) {
    hint.dataset.state = "warning";
    hint.textContent = "发现同名不同编号，请补填并核对病案/住院号，系统不会自动合并";
    return;
  }
  if (matches.idToken) {
    hint.textContent = "未匹配到此编号；归档时将建立新的个人档案，请核对编号是否完整";
    return;
  }
  hint.textContent = "未匹配到已有个人；归档时将建立新的个人档案";
}

function personKey(record) {
  return getCanonicalPatientKey(record);
}

function legacyPersonKey(record) {
  return (record.personId ? `id:${record.personId}` : record.personName ? `name:${record.personName}` : "unassigned").trim().toLowerCase();
}

function personLabel(record) {
  return record.personName || record.personId || "未指定个人";
}

function getPatientRepresentative(records = []) {
  return records.find((record) => record.personName && record.personId)
    || records.find((record) => record.personName)
    || records.find((record) => record.personId)
    || records[0]
    || {};
}

function personMeta(record) {
  if (record.personName && record.personId) return record.personId;
  if (record.personName) return "未填写病案/就诊号";
  if (record.personId) return "仅填写病案/就诊号";
  return "需要补充姓名或病案/就诊号";
}

function renderPersonFilter() {
  const current = els.personFilterSelect.value || "全部";
  const people = new Map();
  state.records.forEach((record) => {
    const key = personKey(record);
    const currentPerson = people.get(key);
    const shouldReplace = !currentPerson
      || (!currentPerson.record.personName && record.personName)
      || (!currentPerson.record.personId && record.personId);
    if (shouldReplace) people.set(key, { label: personLabel(record), meta: personMeta(record), record });
  });
  els.personFilterSelect.innerHTML = `<option value="全部">全部个人</option>${[...people.entries()].map(([key, person]) => `<option value="${escapeHtml(key)}">${escapeHtml(person.label)}${person.meta && person.meta !== "未填写病案/就诊号" ? ` · ${escapeHtml(person.meta)}` : ""}</option>`).join("")}`;
  els.personFilterSelect.value = people.has(current) ? current : "全部";
}

function getVisibleRecords() {
  const query = els.searchInput.value.trim().toLowerCase();
  const filter = els.filterSelect.value;
  renderPersonFilter();
  const selectedPerson = els.personFilterSelect.value;
  return state.records.filter((record) => {
    const matchesFilter = filter === "全部" || record.type === filter;
    const matchesPerson = selectedPerson === "全部" || personKey(record) === selectedPerson;
    const searchable = `${record.title} ${record.type} ${record.note} ${record.text} ${record.summary || ""} ${(record.numbers || []).join(" ")}`.toLowerCase();
    const personSearchable = `${record.personName || ""} ${record.personId || ""}`.toLowerCase();
    return matchesFilter && matchesPerson && (!query || searchable.includes(query) || personSearchable.includes(query));
  });
}

function formatOverviewDate(record) {
  const value = getResearchRecordDate(record);
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "未识别";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function getPerforationEvidence(records) {
const sources = [["研究分组", "perforationStatus"], ["影像", "imagingPerforation"], ["术中", "perforation_primary"], ["病理", "pathologyPerforation"]];
  const states = sources.map(([label, key]) => {
    const values = records.map((record) => String(record.appendicitisData?.[key] || "").trim()).filter(isAppendicitisValueFilled);
    if (!values.length) return "";
    const value = values.includes("明确穿孔") ? "明确穿孔" : values.includes("有") ? "有" : values.includes("是") ? "是" : values.includes("疑似穿孔") ? "疑似穿孔" : values.includes("不确定") ? "不确定" : values.includes("未见穿孔") ? "未见穿孔" : values.includes("无") ? "无" : values.includes("否") ? "否" : values[values.length - 1];
    return `${label}：${value}`;
  }).filter(Boolean);
  const hasConcern = states.some((item) => item.endsWith("：有") || item.endsWith("：是") || item.endsWith("：不确定") || item.endsWith("：明确穿孔") || item.endsWith("：疑似穿孔"));
  return { label: states.join("；") || "未补录", hasConcern };
}

function getPatientOverviewRows(records) {
  const groups = new Map();
  records.forEach((record) => {
    const key = personKey(record);
    if (!groups.has(key)) groups.set(key, { key, person: record, records: [] });
    groups.get(key).records.push(record);
  });
  return [...groups.values()].map((group) => {
    const dates = group.records.map((record) => ({ value: getResearchRecordDate(record), label: formatOverviewDate(record) }))
      .filter((item) => item.value instanceof Date && !Number.isNaN(item.value.getTime()))
      .sort((first, second) => first.value.getTime() - second.value.getTime());
    const metrics = group.records.flatMap((record) => getResearchMetrics(record).filter(isMetricForReview));
    const issueLabels = [...new Set(metrics.map((metric) => `${metric.abbreviation || metric.name || "指标"} ${metric.value || ""}${metric.flag ? ` ${metric.flag}` : ""}`.trim()).filter(Boolean))];
    const hasPendingReview = group.records.some((record) => record.reviewStatus !== "人工已复核");
    const typeLabels = [...new Set(group.records.map((record) => record.type).filter(Boolean))];
    const perforation = getPerforationEvidence(group.records);
    const firstDate = dates[0]?.label || "未识别";
    const lastDate = dates[dates.length - 1]?.label || firstDate;
    return {
      key: group.key,
      label: personLabel(getPatientRepresentative(group.records)),
      personId: group.records.find((record) => record.personId)?.personId || "",
      count: group.records.length,
      types: typeLabels.join("、") || "未分类",
      dateRange: firstDate === lastDate ? firstDate : `${firstDate} 至 ${lastDate}`,
      perforation: perforation.label,
      perforationConcern: perforation.hasConcern,
      issues: issueLabels,
      hasPendingReview,
    };
  }).sort((first, second) => String(first.label).localeCompare(String(second.label), "zh-CN"));
}

function renderArchiveOverview(records) {
  if (!els.overviewStats || !els.overviewBody || !els.overviewEmpty) return;
  const rows = getPatientOverviewRows(records);
  const metricCount = records.reduce((total, record) => total + getResearchMetrics(record).length, 0);
  const issueCount = rows.reduce((total, row) => total + row.issues.length, 0);
  const perforationCount = rows.filter((row) => row.perforationConcern).length;
  const pendingCount = records.filter((record) => record.reviewStatus !== "人工已复核").length;
  els.overviewStats.innerHTML = [
    `<span><strong>${rows.length}</strong> 名个人/病例</span>`,
    `<span><strong>${records.length}</strong> 份资料</span>`,
    `<span><strong>${metricCount}</strong> 项指标</span>`,
    `<span class="overview-stat-warning"><strong>${perforationCount}</strong> 个病例有/疑似穿孔证据</span>`,
    `<span class="overview-stat-warning"><strong>${issueCount}</strong> 项异常/待复核</span>`,
    pendingCount ? `<span class="overview-stat-warning"><strong>${pendingCount}</strong> 份未完成复核</span>` : "",
  ].filter(Boolean).join("");
  els.overviewBody.innerHTML = rows.map((row) => {
    const issues = row.issues.length ? `${row.issues.slice(0, 3).map(escapeHtml).join("；")}${row.issues.length > 3 ? ` 等 ${row.issues.length} 项` : ""}` : (row.hasPendingReview ? "待完成人工复核" : "未发现异常标记");
    return `<tr><td><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(row.personId || "未填写病案/就诊号")}</small></td><td>${row.count} 份</td><td>${escapeHtml(row.types)}</td><td>${escapeHtml(row.dateRange)}</td><td class="${row.perforationConcern ? "overview-issue" : "overview-ok"}">${escapeHtml(row.perforation)}</td><td class="${row.issues.length || row.hasPendingReview ? "overview-issue" : "overview-ok"}">${issues}</td><td><button class="button button-ghost overview-person-button" type="button" data-overview-person="${escapeHtml(row.key)}">查看此人</button></td></tr>`;
  }).join("");
  els.overviewEmpty.hidden = rows.length > 0;
  els.overviewBody.parentElement.parentElement.hidden = rows.length === 0;
}

function buildOverviewText(records) {
  const rows = getPatientOverviewRows(records);
  if (!rows.length) return "";
  const header = ["个人/病例", "病案/就诊号", "资料数", "资料类型", "报告时间", "穿孔证据", "异常/待复核"].join("\t");
  const body = rows.map((row) => [row.label, row.personId, row.count, row.types, row.dateRange, row.perforation, row.issues.join("；") || (row.hasPendingReview ? "待复核" : "未发现异常标记")].join("\t"));
  return [header, ...body].join("\n");
}

function renderRecords() {
  const records = getVisibleRecords();
  renderArchiveOverview(records);
  els.recordTotal.textContent = `${state.records.length} 条`;
  const groups = new Map();
  records.forEach((record) => {
    const key = personKey(record);
    if (!groups.has(key)) groups.set(key, { person: record, records: [] });
    groups.get(key).records.push(record);
  });
  groups.forEach((group) => { group.person = getPatientRepresentative(group.records); });
  els.recordList.innerHTML = [...groups.values()].map((group) => `
    <section class="person-group">
      <div class="person-group-heading"><span class="person-avatar">${escapeHtml(personLabel(group.person).slice(0, 1))}</span><div><strong>${escapeHtml(personLabel(group.person))}</strong><small>${escapeHtml(personMeta(group.person))} · ${group.records.length} 份资料</small></div></div>
      <div class="person-group-records">${group.records.map((record) => `
        <article class="record-card" data-id="${escapeHtml(record.id)}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(record.title)}">
          <div class="record-card-top"><span class="record-type">${escapeHtml(record.type)}</span><span class="record-date">${escapeHtml(formatDate(record.createdAt))}</span></div>
          <h3>${escapeHtml(record.title)}</h3>
          <p class="record-excerpt">${escapeHtml(record.summary || record.text)}</p>
          <div class="record-card-bottom"><span class="record-numbers">${record.numbers?.length ? `${record.numbers.slice(0, 3).map(escapeHtml).join(" · ")}${record.numbers.length > 3 ? " …" : ""}` : "未提取到数字"}</span><span class="review-pill ${record.reviewStatus === "人工已复核" ? "reviewed" : "pending"}">${escapeHtml(record.reviewStatus || "待人工复核")}</span><span class="record-open">↗</span></div>
        </article>
      `).join("")}</div>
    </section>
  `).join("");
  els.archiveEmpty.style.display = records.length ? "none" : "flex";
  if (!records.length && (query || filter !== "全部" || selectedPerson !== "全部")) {
    els.archiveEmpty.querySelector("strong").textContent = "没有匹配的资料";
    els.archiveEmpty.querySelector("span").textContent = "试试其他关键词或筛选条件";
  } else {
    els.archiveEmpty.querySelector("strong").textContent = "本机档案还是空的";
    els.archiveEmpty.querySelector("span").textContent = "完成一次 OCR 校对后，资料会出现在这里";
  }
  updatePatientMatchHint();
}

function renderSavedMetrics(metrics = []) {
  if (!metrics.length) return "";
  const rows = metrics.map((metric) => {
    const hasConfidence = Number.isFinite(metric.confidence);
    const confidence = hasConfidence ? `${Math.round(metric.confidence * 100)}%` : "未提供";
    const confidenceClass = !hasConfidence || metric.confidence < 0.6 ? "low-confidence" : metric.confidence < 0.8 ? "medium-confidence" : "";
    const resultDisplay = metric.rawValue && metric.rawValue !== metric.value ? `${metric.rawValue} → ${metric.value}` : (metric.value || "");
    const reviewStatus = metric.reviewStatus || (metric.manualEdited ? "人工修改待确认" : "随资料复核");
    return `<tr><td>${escapeHtml(metric.name || "")}</td><td>${escapeHtml(metric.abbreviation || "—")}</td><td>${escapeHtml(resultDisplay)}</td><td>${escapeHtml(metric.reference || "—")}</td><td>${escapeHtml(metric.unit || "—")}</td><td class="${metric.flag ? "flag-cell" : ""}">${escapeHtml(metric.flag || "—")}</td><td>${metric.sourcePage ? `第${escapeHtml(metric.sourcePage)}张` : "—"}</td><td>${escapeHtml(reviewStatus)}</td><td class="${confidenceClass}">${confidence}</td></tr>`;
  }).join("");
  return `<div class="saved-metrics"><div class="dialog-section-title">已归档结构化指标 <small>${metrics.length} 项；箭头表示人工修正</small></div><div class="metric-table-scroll"><table class="metric-table"><thead><tr><th>项目</th><th>缩写</th><th>结果（原值→当前）</th><th>参考范围</th><th>单位</th><th>提示</th><th>来源页</th><th>复核状态</th><th>置信度</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderSavedAppendicitisData(data = {}) {
  const filled = APPENDICITIS_FIELD_DEFS.filter((field) => isAppendicitisValueFilled(data[field.key]));
  if (!filled.length) return "";
  const rows = filled.map((field) => `<div class="saved-field"><small>${escapeHtml(field.label)}</small><strong>${escapeHtml(data[field.key])}</strong></div>`).join("");
  return `<div class="saved-appendicitis"><div class="dialog-section-title">阑尾炎现场采集字段 <small>${filled.length}/${APPENDICITIS_FIELD_DEFS.length} 项</small></div><div class="saved-field-grid">${rows}</div></div>`;
}

function openRecord(id) {
  const record = state.records.find((item) => item.id === id);
  if (!record) return;
  state.editingRecordId = id;
  els.dialogTitle.textContent = record.title;
  els.dialogBody.innerHTML = `
    <div class="dialog-images">${(record.images || []).map((image, index) => `<img src="${image}" alt="归档图片 ${index + 1}" />`).join("")}</div>
    <div class="dialog-meta"><div class="meta-item"><small>个人/患者</small><strong>${escapeHtml(personLabel(record))}</strong></div><div class="meta-item"><small>病案/就诊号</small><strong>${escapeHtml(record.personId || "未填写")}</strong></div><div class="meta-item"><small>资料类型</small><strong>${escapeHtml(record.type)}</strong></div><div class="meta-item"><small>病例ID来源</small><strong>${escapeHtml(record.studyIdOrigin || getStudyIdOrigin(record.appendicitisData, record.personName, record.personId))}</strong></div><div class="meta-item"><small>批次质控</small><strong>${escapeHtml(record.batchAudit ? (record.batchAudit.identityConflict || record.batchAudit.mixedTypes ? "需处理冲突" : "通过") : "旧记录/未生成")}</strong></div><div class="meta-item"><small>复核状态</small><strong>${escapeHtml(record.reviewStatus || "待人工复核")}</strong></div><div class="meta-item"><small>归档时间</small><strong>${escapeHtml(formatDate(record.createdAt))}</strong></div></div>
    ${record.summary ? `<div class="dialog-text saved-summary"><div class="dialog-section-title">归档总结</div>${escapeHtml(record.summary)}</div><button class="button button-secondary copy-summary-button" type="button" data-copy-summary>复制归档总结</button>` : ""}
    ${renderSavedAppendicitisData(record.appendicitisData)}
    ${renderSavedMetrics(record.metrics)}
    <div class="dialog-text">${escapeHtml(record.text)}</div>
    ${record.note ? `<p class="dialog-note">备注：${escapeHtml(record.note)}</p>` : ""}
  `;
  if (typeof els.recordDialog.showModal === "function") els.recordDialog.showModal();
  else els.recordDialog.setAttribute("open", "true");
}

async function copyTextToClipboard(text, successMessage = "已复制") {
  const value = String(text || "").trim();
  if (!value) { showToast("当前没有可复制的归纳内容", "error"); return false; }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const helper = document.createElement("textarea");
      helper.value = value;
      helper.setAttribute("readonly", "true");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    showToast(successMessage);
    return true;
  } catch {
    showToast("当前浏览器不允许自动复制，请手动选择文字复制", "error");
    return false;
  }
}

async function copyCurrentSummary() {
  const record = state.records.find((item) => item.id === state.editingRecordId);
  if (!record?.summary) return;
  await copyTextToClipboard(record.summary, "归档总结已复制，可粘贴到病程记录或其他文档");
}

async function deleteCurrentRecord() {
  if (!state.editingRecordId) return;
  const record = state.records.find((item) => item.id === state.editingRecordId);
  if (!record || !window.confirm(`确定删除“${record.title}”吗？此操作无法撤销。`)) return;
  try {
    await removeRecord(record.id);
    state.records = state.records.filter((item) => item.id !== record.id);
    renderRecords();
    updateStorageStatus();
    els.recordDialog.close();
    showToast("已从本机档案删除");
  } catch { showToast("删除失败，请重试", "error"); }
}

function getReportDate(record) {
  const text = String(record.text || "");
  const labeledMatch = text.match(/(?:报告时间|报告日期|检查日期|申请日期)\s*[:：]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s*\d{1,2}[:：]\d{2}(?::\d{2})?)?)/);
  if (labeledMatch?.[1]) return labeledMatch[1];
  return text.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s*\d{1,2}[:：]\d{2}(?::\d{2})?)?)/)?.[1] || "";
}

function getResearchDateValue(rawValue) {
  const raw = String(rawValue || "").replace(/\//g, "-").replace(/：/g, ":").replace(/\s+/g, " ").trim();
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return raw;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    match[4] ? Number(match[4]) : 12,
    Number(match[5] || 0),
    Number(match[6] || 0),
  );
}

function getLocalDateStamp(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function getResearchRecordDate(record) {
  return getResearchDateValue(getReportDate(record));
}

function getStableResearchHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function getResearchPatientId(record) {
  const studyId = String(record?.appendicitisData?.study_id || record?.appendicitisData?.studyId || "").trim();
  const studyIdOrigin = getStudyIdOrigin(record?.appendicitisData, record?.personName, record?.personId);
  if (studyId && studyIdOrigin === "人工研究编号") return studyId;
  const canonicalPersonKey = personKey(record);
  if (canonicalPersonKey && canonicalPersonKey !== "unassigned") return `CASE-${getStableResearchHash(canonicalPersonKey)}`;
  return studyId || `CASE-${getStableResearchHash(`record:${record?.id || "unknown"}`)}`;
}

function getResearchPatientGroupingKey(record) {
  const studyId = String(record?.appendicitisData?.study_id || record?.appendicitisData?.studyId || "").trim();
  const studyIdOrigin = getStudyIdOrigin(record?.appendicitisData, record?.personName, record?.personId);
  return studyId && studyIdOrigin === "人工研究编号" ? `study:${studyId}` : personKey(record);
}

function getResearchRecordId(record, index) {
  return String(record?.id || `REC-${String(index + 1).padStart(4, "0")}`);
}

function getResearchMetrics(record) {
  if (Array.isArray(record.metrics) && record.metrics.length) return record.metrics;
  if (record.text && labFieldRules[record.type]) return extractAllLabRows(record.text, [], record.type);
  return [];
}

function getResearchMetricNumber(metric) {
  const rawValue = String(metric?.value || "").replace(/,/g, "");
  const match = rawValue.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
  if (!match) return "";
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : "";
}

function getResearchMetricConfidence(metric) {
  const confidence = Number(metric?.confidence);
  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : "";
}

function getResearchVariableCode(record, metric) {
  const typeCode = ({ "血常规": "CBC", "肝肾功能": "LIVER_KIDNEY", "止凝血": "COAG", CT: "CT", 彩超: "US" })[record.type] || "OTHER";
  const abbreviation = String(metric?.abbreviation || "").trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (abbreviation) return `${typeCode}_${abbreviation}`.slice(0, 80);
  return `${typeCode}_V_${getStableResearchHash(`${record.type || "其他"}|${metric?.name || "未命名指标"}`)}`;
}

function mergeAppendicitisData(target, next = {}) {
  Object.entries(next || {}).forEach(([key, value]) => {
    const incoming = String(value || "").trim();
    const current = String(target[key] || "").trim();
    if (!isAppendicitisValueFilled(incoming)) return;
    if (!isAppendicitisValueFilled(current) || APPENDICITIS_MISSING_VALUES.has(current)) target[key] = incoming;
  });
  return target;
}

function getPatientInclusionStatus(records = []) {
  const merged = records.reduce((target, record) => mergeAppendicitisData(target, record.appendicitisData), {});
  return getStudyInclusionStatus(merged);
}

const APPENDICITIS_RESEARCH_TABLES = [
  {
    key: "patient",
    name: "患者与纳入信息",
    sourceGroups: ["basic", "perforationCore", "treatment", "pathology"],
    fields: ["study_id", "hospital_center", "age", "sex", "heightCm", "weightKg", "bmi", "admission_datetime", "first_acute_appendicitis_episode", "index_episode", "perforationStatus", "laparoscopy_exploration", "laparoscopy_completed", "appendectomy_attempted", "conversion_to_open", "conversion_reason", "pathology_acute_appendicitis_confirmed", "exclusion_reason"],
  },
  {
    key: "preoperativeClinical",
    name: "术前临床资料",
    sourceGroups: ["symptoms", "preoperative"],
    fields: ["age", "sex", "bmi", "preop_timepoint", "preop_assessment_time", "preop_antibiotic_status", "symptom_onset_datetime", "painDurationHours", "right_lower_quadrant_pain", "migratoryPain", "nausea_vomiting", "appetite_loss", "diarrhea", "fever_chills", "right_lower_quadrant_tenderness", "rebound_pain", "guarding", "localized_peritoneal_irritation", "diffuse_peritoneal_irritation", "reboundGuarding", "admissionTempC", "clinicalPeritonitis", "heart_rate", "systolic_bp", "diastolic_bp", "respiratory_rate", "spo2", "antibiotics_before_admission", "analgesics_before_admission"],
  },
  {
    key: "preoperativeLabs",
    name: "术前实验室指标",
    sourceGroups: ["labs"],
    fields: ["lab_timepoint", "lab_collection_time", "lab_collection_status", "wbc", "neutAbs", "neutPct", "lymphAbs", "lymphPct", "monocyteAbs", "monocytePct", "hgb", "plt", "crp", "pct", "albumin", "totalBilirubin", "creatinine", "egfr", "urea", "glucose", "lactate", "fibrinogen", "ast", "alt", "sodium", "potassium", "chloride", "calcium"],
  },
  {
    key: "preoperativeImaging",
    name: "术前影像资料",
    sourceGroups: ["imaging"],
    fields: ["imaging_timepoint", "imaging_exam_time", "imaging_status", "imagingMethod", "appendixDiameterMm", "imagingAppendicolith", "appendicolithSizeMm", "appendix_wall_discontinuity", "fatStranding", "periAppendicealFluid", "free_fluid", "freeGas", "imagingAbscess", "imagingPhlegmon", "imaging_abscess_size_cm", "imagingPerforation", "imaging_perforation_location"],
  },
  {
    key: "operativeWses",
    name: "术中结局_WSES",
    sourceGroups: ["perforationCore", "operative", "labelAdjudication", "pathology"],
    fields: ["perforationStatus", "perforationBasis", "appendix_macroscopic_status", "perforation_primary", "perforation_location", "perforation_type", "necrosis_present", "necrosis_location", "phlegmon_present", "abscess_present", "operative_abscess_size_cm", "peritoneal_extent", "contamination_type", "free_appendicolith", "final_wses_grade", "grade_source", "simpleInflammation", "suppuration", "gangrene", "operativeAppendicolith", "operativePurulentExudate", "suggested_wses_grade", "machine_grade_basis", "machine_grade_algorithm_version", "operative_report_available", "operative_media_available", "unknown_reason", "reviewer_1_grade", "reviewer_2_grade", "final_adjudicated_grade", "reviewer_1_comment", "reviewer_2_comment", "label_adjudication_status", "pathology_acute_appendicitis_confirmed", "pathologyDiagnosis", "pathologyPerforation", "pathologyAppendicolith", "appendixTumor", "pathologyText"],
  },
  {
    key: "postoperative",
    name: "手术与术后结局",
    sourceGroups: ["treatment", "outcomes"],
    fields: ["antibioticTime", "operationStartTime", "treatmentStrategy", "surgeryMethod", "laparoscopy_exploration", "laparoscopy_completed", "appendectomy_attempted", "conversion_to_open", "conversion_reason", "operationDurationMin", "drainagePlaced", "drainageDurationDays", "postoperative_antibiotic_name", "postoperative_antibiotic_duration_days", "icu_admission", "discharge_date", "lengthOfStayDays", "ssi30d", "intraabdominalAbscess30d", "ileusObstruction30d", "readmission30d", "reintervention30d", "death30d", "clavien_dindo_grade", "otherComplication"],
  },
];

function getAppendicitisResearchTableDefinition(tableKey) {
  return APPENDICITIS_RESEARCH_TABLES.find((table) => table.key === tableKey) || APPENDICITIS_RESEARCH_TABLES[0];
}

function getAppendicitisResearchTableFields(tableKey) {
  const table = getAppendicitisResearchTableDefinition(tableKey);
  const fields = new Map(APPENDICITIS_FIELD_DEFS.map((field) => [field.key, field]));
  return table.fields.map((key) => fields.get(key)).filter(Boolean);
}

function getAppendicitisResearchSourceRecords(patient, tableKey) {
  const table = getAppendicitisResearchTableDefinition(tableKey);
  const sourceTypes = new Set(table.sourceGroups.flatMap((groupKey) => {
    const group = APPENDICITIS_FIELD_GROUPS.find((candidate) => candidate.key === groupKey);
    return group?.types || [];
  }));
  if (!sourceTypes.size) return patient.records;
  const matchingRecords = patient.records.filter((record) => sourceTypes.has(record.type));
  return matchingRecords.length ? matchingRecords : patient.records;
}

function getAppendicitisResearchTableSheet(patients, tableKey) {
  const fields = getAppendicitisResearchTableFields(tableKey);
  const headers = [
    "病例ID",
    "身份匹配级别",
    "姓名/患者",
    "病案/住院/就诊号",
    "来源资料ID",
    "来源资料类型",
    "首份相关报告日期",
    ...fields.map((field) => field.key + "｜" + field.label),
  ];
  const rows = patients.map((patient) => {
    const sourceRecords = getAppendicitisResearchSourceRecords(patient, tableKey);
    const representative = getPatientRepresentative(patient.records);
    const dates = sourceRecords
      .map(getResearchRecordDate)
      .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
      .sort((first, second) => first.getTime() - second.getTime());
    return [
      patient.patientId,
      getPatientIdentityQuality(patient),
      representative.personName || "",
      patient.records.find((record) => record.personId)?.personId || "",
      sourceRecords.map((record) => record.id).join(" | "),
      [...new Set(sourceRecords.map((record) => record.type).filter(Boolean))].join("、"),
      dates[0] || "",
      ...fields.map((field) => patient.appendicitisData?.[field.key] || ""),
    ];
  });
  return { headers, rows };
}

function getAppendicitisFieldDictionary() {
  const memberships = new Map();
  APPENDICITIS_RESEARCH_TABLES.forEach((table) => {
    table.fields.forEach((key) => {
      if (!memberships.has(key)) memberships.set(key, []);
      memberships.get(key).push(table);
    });
  });
  return APPENDICITIS_FIELD_DEFS.map((field) => {
    const tables = memberships.get(field.key) || [];
    const tableNames = tables.map((table) => table.name).join("；");
    const isPreoperative = tables.some((table) => table.key.startsWith("preoperative"));
    const isOperative = tables.some((table) => table.key === "operativeWses");
    const isPostoperative = tables.some((table) => table.key === "postoperative");
    const isAdjudication = field.groupKey === "labelAdjudication";
    return [
      field.key,
      field.label,
      tableNames,
      field.groupTitle || "",
      field.type || "",
      field.options?.join("；") || "",
      isPreoperative ? "是" : "否",
      isOperative ? "是" : "否",
      isPostoperative ? "是" : "否",
      isAdjudication ? "是" : "否",
    ];
  });
}

function buildResearchWorkbookRows() {
  const orderedRecords = state.records
    .slice()
    .sort((first, second) => String(personLabel(first)).localeCompare(String(personLabel(second)), "zh-CN") || Number(first.createdAt || 0) - Number(second.createdAt || 0));
  const patientMap = new Map();
  const recordRows = [];
  const metricRows = [];
  const variableMap = new Map();

  orderedRecords.forEach((record, index) => {
    const patientKey = getResearchPatientGroupingKey(record);
    const patientId = getResearchPatientId(record);
    if (!patientMap.has(patientKey)) patientMap.set(patientKey, { patientId, records: [], appendicitisData: {} });
    const patient = patientMap.get(patientKey);
    if (String(record?.appendicitisData?.study_id || record?.appendicitisData?.studyId || "").trim()) patient.patientId = patientId;
    patient.records.push(record);
    mergeAppendicitisData(patient.appendicitisData, record.appendicitisData);
    const archivePatientId = patient.patientId;

    const recordId = getResearchRecordId(record, index);
    const reportDate = getResearchRecordDate(record);
    const metrics = getResearchMetrics(record);
    recordRows.push([
      recordId,
      archivePatientId,
      record.studyIdOrigin || getStudyIdOrigin(record.appendicitisData, record.personName, record.personId),
      record.personName || "",
      record.personId || "",
      reportDate,
      record.type || "",
      getStudyInclusionStatus(record.appendicitisData),
      record.title || "",
      record.createdAt ? new Date(Number(record.createdAt)) : "",
      record.ocrEngine || "",
      record.ocrEdited ? "是" : "否",
      record.reviewStatus || "待人工复核",
      record.batchAudit ? (record.batchAudit.identityConflict || record.batchAudit.mixedTypes ? "需处理批次冲突" : "批次质控通过") : "旧记录/未生成批次质控",
      (record.images || []).length,
      metrics.length,
      getAppendicitisFilledCount(record.appendicitisData),
      record.summary || "",
      record.ocrOriginalText || record.text || "",
      record.note || "",
    ]);

    metrics.forEach((metric, metricIndex) => {
      const variableCode = getResearchVariableCode(record, metric);
      const resultNumber = getResearchMetricNumber(metric);
      const confidence = getResearchMetricConfidence(metric);
      metricRows.push([
        `${recordId}-M${String(metricIndex + 1).padStart(3, "0")}`,
        recordId,
        archivePatientId,
        record.personName || "",
        record.personId || "",
        reportDate,
        metric.sourcePage || "",
        metric.sourceBox || "",
        record.type || "",
        getStudyInclusionStatus(record.appendicitisData),
        variableCode,
        metric.name || "未命名指标",
        metric.abbreviation || "",
        metric.rawValue || metric.value || "",
        metric.value || "",
        resultNumber,
        metric.unit || "",
        metric.reference || "",
        metric.flag || "",
        confidence,
        metric.reviewStatus || (metric.manualEdited ? "人工修改待确认" : record.reviewStatus || "待人工复核"),
        metric.sourceText || "",
        record.title || "",
      ]);
      if (!variableMap.has(variableCode)) {
        variableMap.set(variableCode, [
          variableCode,
          record.type || "",
          metric.name || "未命名指标",
          metric.abbreviation || "",
          resultNumber === "" ? "文本" : "数值",
          metric.unit || "",
          metric.reference || "",
          "由 OCR 动态识别；原始结果和复核状态见指标明细表",
           record.reviewStatus || "待人工复核",
        ]);
      }
    });
  });

  const patientRows = [...patientMap.values()].map((patient) => {
    const dates = patient.records
      .map(getResearchRecordDate)
      .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
      .sort((first, second) => first.getTime() - second.getTime());
    const types = [...new Set(patient.records.map((record) => record.type).filter(Boolean))].join("、");
    const metricsCount = patient.records.reduce((total, record) => total + getResearchMetrics(record).length, 0);
    const firstRecord = patient.records.find((record) => record.personName) || patient.records[0] || {};
    const idRecord = patient.records.find((record) => record.personId) || patient.records[0] || {};
    const appendicitisData = patient.appendicitisData || {};
    const reviewPending = patient.records.some((record) => record.reviewStatus !== "人工已复核");
    return [
      patient.patientId,
      getPatientIdentityQuality(patient),
      firstRecord.personName || "",
      idRecord.personId || "",
      patient.records.length,
      dates[0] || "",
      dates[dates.length - 1] || "",
      types,
      getPatientInclusionStatus(patient.records),
      "已归档",
       reviewPending ? (metricsCount ? `${metricsCount} 项指标待人工复核` : "文本资料待人工复核") : "资料已人工复核",
      "含直接身份信息；对外共享前请按研究方案去标识化",
      getAppendicitisFilledCount(appendicitisData),
      ...APPENDICITIS_FIELD_DEFS.map((field) => appendicitisData[field.key] || ""),
    ];
  });
  const patients = [...patientMap.values()];
  const researchSheets = Object.fromEntries(APPENDICITIS_RESEARCH_TABLES.map((table) => [table.key, getAppendicitisResearchTableSheet(patients, table.key)]));

  return {
    patientHeaders: ["病例ID", "身份匹配级别", "姓名/患者", "病案/住院/就诊号", "资料份数", "首份报告日期", "末份报告日期", "资料类型", "研究纳入状态", "归档状态", "复核提示", "隐私处理提示", "阑尾炎字段数", ...APPENDICITIS_FIELD_DEFS.map((field) => field.label)],
    patientRows,
    recordHeaders: ["资料记录ID", "病例ID", "病例ID来源", "姓名/患者", "病案/住院/就诊号", "报告日期", "资料类型", "研究纳入状态", "资料标题", "采集/归档时间", "识别引擎", "OCR是否修改", "复核状态", "批次质控", "原图张数", "指标数", "阑尾炎字段数", "归档总结", "原始OCR文本", "归档备注"],
    recordRows,
    metricHeaders: ["指标记录ID", "资料记录ID", "病例ID", "姓名/患者", "病案/住院/就诊号", "报告日期", "来源页", "来源区域(像素)", "资料类型", "研究纳入状态", "变量编码", "指标名称", "英文缩写", "结果原值", "结果当前值", "结果数值", "单位", "参考范围", "异常提示", "OCR置信度", "指标复核状态", "来源OCR行", "来源资料标题"],
    metricRows,
    variableHeaders: ["变量编码", "资料类型", "指标名称", "英文缩写", "数据类型", "单位示例", "参考范围示例", "字段说明", "默认复核状态"],
    variableRows: [...variableMap.values()].sort((first, second) => String(first[0]).localeCompare(String(second[0]), "zh-CN")),
    hospitalCorrectionHeaders: ["原始缩写", "标准缩写", "项目名称", "单位", "资料类型", "更新时间"],
    hospitalCorrectionRows: getHospitalCorrections().map((item) => [item.raw || "", item.canonical || "", item.nameKey || "", item.unitKey || "", item.recordType || "", item.updatedAt ? new Date(Number(item.updatedAt)) : ""]),
    researchSheets,
    appendicitisFieldHeaders: ["字段编码", "字段名称", "研究数据表", "字段分组", "字段类型", "选项", "是否术前预测变量", "是否术中主要结局", "是否术后结局", "是否标签复核"],
    appendicitisFieldRows: getAppendicitisFieldDictionary(),
  };
}

function setResearchColumnFormat(sheet, headers, rowCount, header, format) {
  const column = headers.indexOf(header);
  if (column < 0) return;
  for (let row = 1; row < rowCount; row += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    if (cell) cell.z = format;
  }
}

function getResearchColumnWidth(header, rows, column) {
  if (["归档总结", "原始OCR文本", "归档备注", "来源OCR行", "字段说明", "隐私处理提示"].includes(header)) return 42;
  const lengths = [header, ...rows.slice(0, 60).map((row) => row[column])].map((value) => Array.from(String(value ?? "")).length);
  return Math.min(36, Math.max(10, Math.max(...lengths, 10) + 2));
}

function appendResearchSheet(workbook, name, headers, rows, formats = {}) {
  const allRows = [headers, ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(allRows);
  sheet["!cols"] = headers.map((header, column) => ({ wch: getResearchColumnWidth(header, rows, column) }));
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: allRows.length - 1, c: headers.length - 1 } }) };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomRight", state: "frozen" };
  Object.entries(formats).forEach(([header, format]) => setResearchColumnFormat(sheet, headers, allRows.length, header, format));
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatStorageBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function updateStorageStatus() {
  if (!els.storageStatus) return;
  const count = state.records.length;
  if (!navigator.storage?.estimate) {
    els.storageStatus.textContent = `当前 ${count} 条记录 · 存储容量由浏览器管理`;
    return;
  }
  try {
    const estimate = await navigator.storage.estimate();
    const usage = Number(estimate.usage || 0);
    const quota = Number(estimate.quota || 0);
    els.storageStatus.textContent = quota
      ? `当前 ${count} 条 · 已使用 ${formatStorageBytes(usage)} / ${formatStorageBytes(quota)}`
      : `当前 ${count} 条记录 · 本机保存`;
  } catch {
    els.storageStatus.textContent = `当前 ${count} 条记录 · 本机保存`;
  }
}

async function importRecordsJson(file) {
  if (!file) return;
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    showToast("备份文件不是有效的 JSON，无法恢复", "error");
    return;
  }
  const sourceRecords = Array.isArray(payload) ? payload : payload?.records;
  if (!Array.isArray(sourceRecords) || !sourceRecords.length) {
    showToast("备份中没有找到可恢复的档案记录", "error");
    return;
  }
  if (sourceRecords.length > 20000) {
    showToast("备份记录数量过大，请拆分后再导入", "error");
    return;
  }
  if (Array.isArray(payload?.hospitalCorrections)) saveHospitalCorrections(payload.hospitalCorrections);
  const existingIds = new Set(state.records.map((record) => record.id));
  const imported = sourceRecords.filter((record) => record && typeof record === "object").map((record, index) => normalizeRecord({
    ...record,
    id: String(record.id || `import-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`),
  }));
  const overwriteCount = imported.filter((record) => existingIds.has(record.id)).length;
  const overwriteHint = overwriteCount ? `其中 ${overwriteCount} 条相同 ID 会覆盖本机旧记录。` : "不会覆盖本机已有记录。";
  if (!window.confirm(`即将导入 ${imported.length} 条档案，${overwriteHint}\n建议导入前确认当前设备已有 JSON 备份。继续吗？`)) return;
  try {
    for (const record of imported) await saveRecord(record);
    const importedMap = new Map(imported.map((record) => [record.id, record]));
    state.records = [...state.records.filter((record) => !importedMap.has(record.id)), ...imported]
      .sort((first, second) => Number(second.createdAt || 0) - Number(first.createdAt || 0));
    renderRecords();
    updateStorageStatus();
    showToast(`已恢复 ${imported.length} 条档案，可继续按个人筛选和导出`);
  } catch (error) {
    console.error(error);
    showToast("备份恢复失败，可能是本机存储空间不足", "error");
  }
}

function exportClinicalDataPackage() {
  if (!state.records.length) { showToast("当前没有可导出的资料", "error"); return; }
  if (!window.XLSX) { showToast("临床数据表格组件尚未加载，请刷新页面后重试", "error"); return; }
  const data = buildResearchWorkbookRows();
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: "临床数据收集科研数据包",
    Subject: "患者/病例、资料记录与指标明细",
    CreatedDate: new Date(),
  };
  appendResearchSheet(workbook, "病例主表", data.patientHeaders, data.patientRows, { "资料份数": "0", "首份报告日期": "yyyy-mm-dd", "末份报告日期": "yyyy-mm-dd" });
  appendResearchSheet(workbook, "资料记录表", data.recordHeaders, data.recordRows, { "报告日期": "yyyy-mm-dd", "采集/归档时间": "yyyy-mm-dd hh:mm", "原图张数": "0", "指标数": "0" });
  appendResearchSheet(workbook, "指标明细表", data.metricHeaders, data.metricRows, { "报告日期": "yyyy-mm-dd", "结果数值": "0.############", "OCR置信度": "0.0%" });
  appendResearchSheet(workbook, "变量字典", data.variableHeaders, data.variableRows);
  appendResearchSheet(workbook, "本院缩写校正", data.hospitalCorrectionHeaders, data.hospitalCorrectionRows, { "更新时间": "yyyy-mm-dd hh:mm" });
  APPENDICITIS_RESEARCH_TABLES.forEach((table) => {
    const sheet = data.researchSheets[table.key];
    appendResearchSheet(workbook, table.name, sheet.headers, sheet.rows, { "首份相关报告日期": "yyyy-mm-dd" });
  });
  appendResearchSheet(workbook, "阑尾炎字段字典", data.appendicitisFieldHeaders, data.appendicitisFieldRows);
  XLSX.writeFile(workbook, `clinical-data-collection-${getLocalDateStamp()}.xlsx`, { bookType: "xlsx", compression: true, cellDates: true });
  showToast(`已导出临床数据包：${data.patientRows.length} 名患者/病例、${data.recordRows.length} 份资料、${data.metricRows.length} 条指标；含术前、术中、术后和复核表`);
}

function exportRecordsJson() {
  if (!state.records.length) { showToast("当前没有可导出的资料", "error"); return; }
  const payload = { exportedAt: new Date().toISOString(), app: "临床采集 / v0.4", hospitalCorrections: getHospitalCorrections(), records: state.records };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `clinical-capture-${getLocalDateStamp()}.json`);
  showToast("已导出本机档案 JSON 备份");
}

els.startCameraButton.addEventListener("click", () => els.startCameraButton.dataset.open ? stopCamera() : startCamera());
els.takePhotoButton.addEventListener("click", takePhoto);
els.imageInput.addEventListener("change", (event) => { addFiles(event.target.files); event.target.value = ""; });
els.scanScreenButton.addEventListener("click", () => els.scanScreenButton.dataset.open ? stopScreenScan() : startScreenScan());
els.previewStrip.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-preview");
  if (!button) return;
  state.images.splice(Number(button.dataset.index), 1);
  renderPreviews();
});
els.recognizeButton.addEventListener("click", recognizeImages);
els.reRecognizeButton.addEventListener("click", recognizeImages);
els.refreshCameraDevicesButton?.addEventListener("click", async () => {
  const devices = await refreshCameraDevices();
  showToast(devices.length ? `已发现 ${devices.length} 个摄像头，可在来源列表中选择手机` : "暂未发现可选摄像头，请先连接手机并在系统中选择 USB 摄像头");
});
els.cameraDeviceSelect?.addEventListener("change", async () => {
  state.cameraDeviceId = els.cameraDeviceSelect.value || "";
  if (!state.stream) {
    showToast(state.cameraDeviceId ? "已选择摄像头，点击“开启相机”即可使用" : "已恢复使用系统默认摄像头");
    return;
  }
  const wasOpen = Boolean(els.startCameraButton.dataset.open);
  if (!wasOpen) return;
  stopCamera();
  await startCamera();
});
els.metricTableBody.addEventListener("input", (event) => {
  if (!event.target.closest("[data-metric-field]")) return;
  const nextMetrics = getEditableMetricRows();
  rememberMetricCorrections(state.metricSourceRows, nextMetrics, els.recordType?.value || "");
  state.currentMetrics = nextMetrics;
  if (event.target.dataset.metricField === "abbreviation") {
    const metricIndex = Number(event.target.dataset.metricIndex);
    event.target.value = state.currentMetrics[metricIndex]?.abbreviation || "";
  }
  if (els.reviewConfirmed) els.reviewConfirmed.checked = false;
  if (!state.summaryManuallyEdited) {
    refreshSummary({ force: true, silent: true });
  }
});
els.ocrText.addEventListener("input", () => { state.ocrText = els.ocrText.value; state.ocrEdited = state.ocrText !== state.ocrOriginalText; if (els.reviewConfirmed) els.reviewConfirmed.checked = false; updateSmartResult(state.ocrText, true); updatePersonDetection(state.ocrText, true); renderNumbers(state.ocrText); renderQualitySummary(state.ocrText); });
els.personName.addEventListener("input", () => { if (els.personName.value.trim()) els.applyDetectedPersonButton.disabled = !state.detectedPersonName && !state.detectedPersonId; if (!state.summaryManuallyEdited && els.ocrText.value.trim()) refreshSummary({ force: true, silent: true }); });
els.personId.addEventListener("input", () => { if (els.personId.value.trim()) els.applyDetectedPersonButton.disabled = !state.detectedPersonName && !state.detectedPersonId; if (!state.summaryManuallyEdited && els.ocrText.value.trim()) refreshSummary({ force: true, silent: true }); });
els.summaryText.addEventListener("input", () => { state.summaryManuallyEdited = true; updateSummaryMeta(); });
els.summaryMode.addEventListener("change", () => {
  state.summaryMode = els.summaryMode.value;
  if (els.summaryModeHint) els.summaryModeHint.textContent = SUMMARY_MODE_HINTS[state.summaryMode] || SUMMARY_MODE_HINTS.research;
  refreshSummary({ force: true, silent: false });
});
els.refreshSummaryButton.addEventListener("click", () => refreshSummary({ force: true, silent: false }));
els.copySummaryButton.addEventListener("click", () => copyTextToClipboard(els.summaryText.value.trim(), "已复制当前归纳，可粘贴到科研记录或表格"));
els.applyDetectedTypeButton.addEventListener("click", () => {
  if (!state.detectedType) return;
  els.recordType.value = state.detectedType;
  state.summaryManuallyEdited = false;
  renderMetricTable(els.ocrText.value, state.detectedType);
  refreshSummary({ force: true, silent: true });
  showToast(`已应用资料类型：${state.detectedType}`);
});
els.applyDetectedPersonButton.addEventListener("click", () => {
  if (!state.detectedPersonName && !state.detectedPersonId) return;
  if (!els.personName.value.trim() && state.detectedPersonName) els.personName.value = state.detectedPersonName;
  if (!els.personId.value.trim() && state.detectedPersonId) els.personId.value = state.detectedPersonId;
  syncAutoStudyId();
  updatePatientMatchHint();
  showToast("已应用个人信息，归档时将归入该个人");
});
els.recordType.addEventListener("change", () => {
  updateAppendicitisFormContext();
  scheduleCaptureDraftSave();
  if (els.ocrText.value.trim()) {
    renderMetricTable(els.ocrText.value, els.recordType.value);
    if (!state.summaryManuallyEdited) refreshSummary({ force: true, silent: true });
    else updateSummaryMeta();
    applyAutoAppendicitisFields(els.ocrText.value, els.recordType.value);
    renderQualitySummary(els.ocrText.value);
  }
});
els.archiveButton.addEventListener("click", archiveCurrent);
els.searchInput.addEventListener("input", renderRecords);
els.filterSelect.addEventListener("change", renderRecords);
els.personFilterSelect.addEventListener("change", renderRecords);
els.overviewBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-overview-person]");
  if (!button) return;
  els.personFilterSelect.value = button.dataset.overviewPerson || "全部";
  renderRecords();
  els.recordList.scrollIntoView({ behavior: "smooth", block: "start" });
});
els.copyOverviewButton.addEventListener("click", () => copyTextToClipboard(buildOverviewText(getVisibleRecords()), "已复制当前个人汇总，可粘贴到 Excel"));
els.recordList.addEventListener("click", (event) => { const card = event.target.closest(".record-card"); if (card) openRecord(card.dataset.id); });
els.recordList.addEventListener("keydown", (event) => { if (event.key === "Enter") { const card = event.target.closest(".record-card"); if (card) openRecord(card.dataset.id); } });
els.exportButton.addEventListener("click", exportClinicalDataPackage);
els.importJsonButton.addEventListener("click", () => els.importJsonInput?.click());
els.importJsonInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  await importRecordsJson(file);
  event.target.value = "";
});
els.exportJsonButton.addEventListener("click", exportRecordsJson);
els.dialogBody.addEventListener("click", (event) => { if (event.target.closest("[data-copy-summary]")) copyCurrentSummary(); });
els.closeDialogButton.addEventListener("click", () => els.recordDialog.close());
els.dialogDoneButton.addEventListener("click", () => els.recordDialog.close());
els.deleteRecordButton.addEventListener("click", deleteCurrentRecord);
window.addEventListener("beforeunload", () => { stopCamera(); stopScreenScan(); });

renderAppendicitisForm();
els.appendicitisForm.addEventListener("input", (event) => {
  const field = event.target.closest("[data-appendicitis-field]");
  if (field?.dataset.appendicitisField === "study_id") delete field.dataset.autoGenerated;
  updateAppendicitisProgress();
  scheduleCaptureDraftSave();
  if (!state.summaryManuallyEdited && els.ocrText.value.trim()) refreshSummary({ force: true, silent: true });
});
els.appendicitisForm.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-toggle-appendicitis-advanced]");
  if (!toggle) return;
  const key = toggle.dataset.toggleAppendicitisAdvanced;
  const panel = els.appendicitisForm.querySelector(`[data-appendicitis-advanced-panel="${key}"]`);
  if (!panel) return;
  panel.hidden = !panel.hidden;
  toggle.textContent = panel.hidden ? "展开复核/溯源信息" : "收起复核/溯源信息";
});
els.appendicitisForm.addEventListener("change", (event) => {
  const field = event.target.closest("[data-appendicitis-field]");
  const fieldKey = field?.dataset.appendicitisField || "";
  if (field && fieldKey !== "suggested_wses_grade" && fieldKey !== "machine_grade_basis" && fieldKey !== "machine_grade_algorithm_version" && fieldKey !== "study_id") {
    const machineBasis = els.appendicitisForm.querySelector('[data-appendicitis-field="machine_grade_basis"]');
    if (machineBasis?.value === "术中记录OCR") machineBasis.value = "术中记录OCR+手工修订";
  }
  if (field?.dataset.appendicitisField === "suggested_wses_grade") {
    field.dataset.manuallyEdited = "true";
    const status = els.appendicitisForm.querySelector('[data-appendicitis-field="label_adjudication_status"]');
    if (status?.value === "机器建议待确认") status.value = "待双人复核";
  }
  updateAppendicitisProgress();
  scheduleCaptureDraftSave();
});
els.appendicitisEnabled.addEventListener("change", () => {
  els.appendicitisCapture.hidden = !els.appendicitisEnabled.checked;
  scheduleCaptureDraftSave();
});
els.continueCaseAfterArchive.addEventListener("change", scheduleCaptureDraftSave);
[els.personName, els.personId, els.recordTitle, els.recordNote].forEach((input) => input.addEventListener("input", scheduleCaptureDraftSave));
[els.personName, els.personId].forEach((input) => input.addEventListener("input", () => { syncAutoStudyId(); updatePatientMatchHint(); }));
restoreCaptureDraft();
ensurePatientMatchHint();
updatePatientMatchHint();
refreshCameraDevices();

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").then((registration) => registration.update()).catch(() => {});
loadRecords();
