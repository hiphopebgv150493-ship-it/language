/**
 * Language Lab - Primary Application Logic
 */

// --- STATE MANAGEMENT ---
const state = {
  profiles: JSON.parse(localStorage.getItem('ll_profiles')) || ['Principal'],
  activeProfile: localStorage.getItem('ll_active_profile') || 'Principal',
  activeTab: 'dictionary',
  dictionaries: JSON.parse(localStorage.getItem('ll_dictionaries')) || [
    { id: 'default', name: 'Inglés', words: [] }
  ],
  activeDictId: localStorage.getItem('ll_active_dict') || 'default',
  songs: JSON.parse(localStorage.getItem('ll_songs')) || [],
  notes: JSON.parse(localStorage.getItem('ll_notes')) || [],
  darkMode: localStorage.getItem('ll_dark_mode') === 'true'
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  initEventListeners();
  renderProfiles();
  renderDictionaries();
  renderWords();
});

// --- EVENT DELEGATION SYSTEM ---
function initEventListeners() {
  // Global Click Actions
  document.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-click-action]');
    if (actionEl) {
      const action = actionEl.getAttribute('data-click-action');
      handleAction(action, actionEl, e);
      return;
    }

    const tabEl = e.target.closest('[data-tab]');
    if (tabEl) {
      switchTab(tabEl.getAttribute('data-tab'));
      return;
    }

    // Dismiss modals when clicking background overlay
    const dismissEl = e.target.closest('[data-dismiss-action]');
    if (dismissEl && e.target === dismissEl) {
      const action = dismissEl.getAttribute('data-dismiss-action');
      handleAction(action, dismissEl, e);
    }
  });

  // Global Input Actions
  document.addEventListener('input', (e) => {
    const inputEl = e.target.closest('[data-input-action]');
    if (inputEl) {
      const action = inputEl.getAttribute('data-input-action');
      handleAction(action, inputEl, e);
    }
  });

  // Global Change Actions
  document.addEventListener('change', (e) => {
    const changeEl = e.target.closest('[data-change-action]');
    if (changeEl) {
      const action = changeEl.getAttribute('data-change-action');
      handleAction(action, changeEl, e);
    }
  });
}

// --- ACTION ROUTER ---
function handleAction(action, element, event) {
  switch (action) {
    // Theme & UI
    case 'toggleDark':
      toggleDarkMode();
      break;
    case 'toggleDesktopSidebar':
      document.getElementById('desktopSidebar').classList.toggle('hidden');
      break;
    case 'toggleMobileSidebar':
      document.getElementById('mobileSidebar').classList.toggle('-translate-x-full');
      document.getElementById('mobileOverlay').classList.toggle('hidden');
      break;
    case 'toggleDropMenu':
      document.getElementById('menuDots').classList.toggle('hidden');
      break;

    // Profiles
    case 'createProfile':
      createProfile();
      break;
    case 'toggleProfiles':
      switchScreen('profileScreen');
      break;
    case 'deleteActiveProfile':
      deleteActiveProfile();
      break;

    // Dictionaries & Words
    case 'addDictModal':
      openModal('dictModal');
      break;
    case 'closeDictModal':
      closeModal('dictModal');
      break;
    case 'saveDict':
      saveDictionary();
      break;
    case 'openWordModal':
      openModal('wordModal');
      break;
    case 'closeWordModal':
      closeModal('wordModal');
      break;
    case 'saveWord':
      saveWord();
      break;
    case 'renderWords':
      renderWords();
      break;

    // Songs
    case 'openSongModal':
      openModal('songModal');
      break;
    case 'closeSongModal':
      closeModal('songModal');
      break;
    case 'saveSong':
      saveSong();
      break;
    case 'renderSongList':
      renderSongList();
      break;

    // Settings & Import/Export
    case 'openSettings':
      openModal('settingsModal');
      break;
    case 'closeSettings':
      closeModal('settingsModal');
      break;
    case 'exportAppBackup':
      exportBackup();
      break;

    default:
      console.log(`Action "${action}" triggered.`);
  }
}

// --- UI & TABS ---
function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });

  document.getElementById('tab-dictionary').classList.toggle('hidden', tabName !== 'dictionary');
  document.getElementById('tab-songs').classList.toggle('hidden', tabName !== 'songs');
  document.getElementById('tab-notebook').classList.toggle('hidden', tabName !== 'notebook');
}

function switchScreen(screenId) {
  if (screenId === 'profileScreen') {
    document.getElementById('profileScreen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  } else {
    document.getElementById('profileScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  }
}

function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  localStorage.setItem('ll_dark_mode', state.darkMode);
  document.documentElement.classList.toggle('dark', state.darkMode);
}

function initDarkMode() {
  if (state.darkMode) {
    document.documentElement.classList.add('dark');
  }
}

// --- MODALS ---
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
}

// --- PROFILES ---
function renderProfiles() {
  const list = document.getElementById('profileList');
  if (!list) return;
  list.innerHTML = '';

  state.profiles.forEach(profile => {
    const item = document.createElement('div');
    item.className = 'p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer flex justify-between items-center';
    item.innerHTML = `<span class="font-medium">${profile}</span>`;
    item.onclick = () => selectProfile(profile);
    list.appendChild(item);
  });
}

function createProfile() {
  const input = document.getElementById('newProfileName');
  const name = input.value.trim();
  if (!name) return;

  if (!state.profiles.includes(name)) {
    state.profiles.push(name);
    localStorage.setItem('ll_profiles', JSON.stringify(state.profiles));
    renderProfiles();
  }
  input.value = '';
  selectProfile(name);
}

function selectProfile(profileName) {
  state.activeProfile = profileName;
  localStorage.setItem('ll_active_profile', profileName);

  document.getElementById('profileNameSidebar').textContent = profileName;
  document.getElementById('avatarInitial').textContent = profileName.charAt(0).toUpperCase();

  showToast(`Perfil: ${profileName}`);
  switchScreen('app');
}

function deleteActiveProfile() {
  if (state.profiles.length <= 1) {
    showToast('No puedes borrar el único perfil existente');
    return;
  }
  state.profiles = state.profiles.filter(p => p !== state.activeProfile);
  localStorage.setItem('ll_profiles', JSON.stringify(state.profiles));
  selectProfile(state.profiles[0]);
  switchScreen('profileScreen');
}

// --- DYNAMIC CONTENT & STORAGE ---
function renderDictionaries() {
  const container = document.getElementById('dictList');
  if (!container) return;
  container.innerHTML = '';

  state.dictionaries.forEach(dict => {
    const btn = document.createElement('button');
    btn.className = `w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${dict.id === state.activeDictId ? 'bg-indigo-50 text-indigo-600' : 'hover:bg-slate-100'}`;
    btn.textContent = dict.name;
    btn.onclick = () => {
      state.activeDictId = dict.id;
      localStorage.setItem('ll_active_dict', dict.id);
      renderDictionaries();
      renderWords();
    };
    container.appendChild(btn);
  });
}

function saveDictionary() {
  const input = document.getElementById('dictName');
  const name = input.value.trim();
  if (!name) return;

  const newDict = { id: Date.now().toString(), name, words: [] };
  state.dictionaries.push(newDict);
  localStorage.setItem('ll_dictionaries', JSON.stringify(state.dictionaries));

  input.value = '';
  closeModal('dictModal');
  renderDictionaries();
  showToast('Diccionario creado');
}

function renderWords() {
  const activeDict = state.dictionaries.find(d => d.id === state.activeDictId) || state.dictionaries[0];
  const container = document.getElementById('wordsList');
  const emptyState = document.getElementById('wordsEmpty');

  if (activeDict) {
    document.getElementById('activeDictTitle').textContent = activeDict.name;
  }

  if (!activeDict || activeDict.words.length === 0) {
    if (container) container.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  container.innerHTML = activeDict.words.map(w => `
    <div class="p-4 hover:bg-slate-50 flex justify-between items-center">
      <div>
        <div class="font-bold text-slate-800">${w.phrase}</div>
        <div class="text-sm text-slate-500">${w.meaning || ''}</div>
      </div>
    </div>
  `).join('');
}

function saveWord() {
  const phraseInput = document.getElementById('wPhrase');
  const meaningInput = document.getElementById('wMeaning');
  const phrase = phraseInput.value.trim();
  if (!phrase) return;

  let activeDict = state.dictionaries.find(d => d.id === state.activeDictId);
  if (!activeDict) activeDict = state.dictionaries[0];

  activeDict.words.push({ phrase, meaning: meaningInput.value.trim(), date: new Date().toISOString() });
  localStorage.setItem('ll_dictionaries', JSON.stringify(state.dictionaries));

  phraseInput.value = '';
  meaningInput.value = '';
  closeModal('wordModal');
  renderWords();
  showToast('Frase guardada');
}

function saveSong() {
  const title = document.getElementById('sTitle').value.trim();
  const artist = document.getElementById('sArtist').value.trim();
  const lyrics = document.getElementById('sLyrics').value.trim();
  if (!title) return;

  state.songs.push({ id: Date.now().toString(), title, artist, lyrics });
  localStorage.setItem('ll_songs', JSON.stringify(state.songs));

  closeModal('songModal');
  showToast('Canción guardada');
}

function exportBackup() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `language_lab_backup_${Date.now()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
}
