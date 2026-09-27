/* =========================================================
   Language Lab — lógica principal de la aplicación.
   Publicar este archivo como app.js junto a index.html.
   ========================================================= */
const LS_KEY = 'languageLearningApp_v1';
const ADMIN_PROFILE_ID = '__language_lab_admin__';
const ACTIVE_TAB_KEY = 'language_lab_active_tab_v1';
const VALID_TABS = ['dictionary','songs','notebook'];
const STATE_DB_NAME = 'language-lab-storage';
const STATE_DB_STORE = 'app';
let stateDatabase = null;
let stateDatabaseReady = false;
let persistenceTimer = null;
let pendingPersistenceRevision = 0;
let lastStoredRevision = 0;
let cachedDictionaryPhrasesProfile=null;
let cachedDictionaryPhrases=[];
let dictionaryPhrasesDirty=true;
let cachedDictionaryPhraseIndexes=null;
let dictionaryIndexBuildGeneration=0;
let dictionaryIndexBuildingFor=null;
function invalidateDictionaryPhraseIndex(){
  dictionaryPhrasesDirty=true;
  cachedDictionaryPhraseIndexes=null;
  dictionaryIndexBuildGeneration++;
  dictionaryIndexBuildingFor=null;
}
function storageGet(key, fallback=null, session=false){
  try{ const value=(session?sessionStorage:localStorage).getItem(key); return value===null?fallback:value; }
  catch(error){ return fallback; }
}
function storageSet(key, value, session=false){
  try{ (session?sessionStorage:localStorage).setItem(key,String(value)); return true; }
  catch(error){ console.warn('No se pudo guardar en el almacenamiento local:',error); return false; }
}
function storageRemove(key, session=false){
  try{ (session?sessionStorage:localStorage).removeItem(key); }catch(error){}
}
let perfilActual = storageGet('perfil_activo','Brando');
const toastEl = () => document.getElementById('toast');
let toastTimer = null;
function toast(msg){
  const t = toastEl();
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.add('hidden'), 2200);
}
const uid = () => Math.random().toString(36).slice(2,9)+Date.now().toString(36);

/* ---------- Data model / persistence ---------- */
let state = load();
function defaultState(){
  return { profiles:{}, activeProfile:null, activeDict:null, activeSong:null, activeNote:null };
}
function normalizeProfile(profile){
  profile.dictionaries ||= {};
  profile.songs ||= {};
  profile.notes ||= {};
  profile.notebookFolders ||= [];
  for(const note of Object.values(profile.notes)) note.folder ||= '';
  return profile;
}
function load(){
  try{
    const raw = storageGet(LS_KEY);
    if(raw){
      const d = JSON.parse(raw);
      if(d && d.profiles){
        const savedProfileId=storageGet('perfil_activo_id');
        if(savedProfileId && d.profiles[savedProfileId]) d.activeProfile=savedProfileId;
        else if(perfilActual && d.profiles[perfilActual]) d.activeProfile = perfilActual;
        else if(perfilActual && !Object.values(d.profiles).some(p=>p.name===perfilActual) && d.activeProfile) perfilActual=d.activeProfile;
        else if(perfilActual && !d.profiles[perfilActual]){
          const match=Object.entries(d.profiles).find(([,p])=>p.name===perfilActual);
          if(match) d.activeProfile=match[0];
        }
        Object.values(d.profiles).forEach(normalizeProfile);
        if(!d.profiles[d.activeProfile]) d.activeProfile=null;
        return d;
      }
    }
  }catch(e){}
  return defaultState();
}
function openStateDatabase(){
  if(!('indexedDB' in window)) return Promise.resolve(null);
  return new Promise(resolve=>{
    let request;
    try{ request=indexedDB.open(STATE_DB_NAME,1); }
    catch(error){ resolve(null); return; }
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains(STATE_DB_STORE)){
        request.result.createObjectStore(STATE_DB_STORE);
      }
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>resolve(null);
    request.onblocked=()=>resolve(null);
  });
}
function readStateDatabase(db){
  return new Promise(resolve=>{
    try{
      const request=db.transaction(STATE_DB_STORE,'readonly').objectStore(STATE_DB_STORE).get('state');
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>resolve(null);
    }catch(error){ resolve(null); }
  });
}
function persistStateDatabase(){
  if(!stateDatabaseReady||!stateDatabase) return false;
  const revision=++pendingPersistenceRevision;
  try{
    const transaction=stateDatabase.transaction(STATE_DB_STORE,'readwrite');
    transaction.objectStore(STATE_DB_STORE).put(state,'state');
    transaction.oncomplete=()=>{
      lastStoredRevision=Math.max(lastStoredRevision,revision);
      if(lastStoredRevision===pendingPersistenceRevision) storageRemove(LS_KEY);
    };
    transaction.onerror=()=>{
      console.warn('No se pudo guardar en la base local; se intentará el almacenamiento clásico.');
      storageSet(LS_KEY,JSON.stringify(state));
    };
    return true;
  }catch(error){
    console.warn('No se pudo guardar en la base local:',error);
    return false;
  }
}
async function initializePersistence(){
  stateDatabase=await openStateDatabase();
  if(!stateDatabase) return;
  Promise.resolve(navigator.storage?.persist?.()).catch(()=>{});
  const stored=await readStateDatabase(stateDatabase);
  if(stored?.profiles){
    state=stored;
    Object.values(state.profiles).forEach(normalizeProfile);
    if(!state.profiles[state.activeProfile]) state.activeProfile=null;
  }
  stateDatabaseReady=true;
  // Migrate the existing localStorage data on first use.
  if(!stored&&storageGet(LS_KEY)) persistStateDatabase();
}
function save(options={}){
  if(state.activeProfile && state.profiles[state.activeProfile]){
    perfilActual=state.profiles[state.activeProfile].name;
    storageSet('perfil_activo',perfilActual);
    storageSet('perfil_activo_id',state.activeProfile);
  }
  clearTimeout(persistenceTimer);
  if(options.immediate){
    if(!persistStateDatabase()) storageSet(LS_KEY, JSON.stringify(state));
    return;
  }
  // Coalesce rapid editor input into one IndexedDB write.
  persistenceTimer=setTimeout(()=>{
    if(!persistStateDatabase()) storageSet(LS_KEY, JSON.stringify(state));
  },320);
}
const sel = {
  profile: ()=> state.profiles[state.activeProfile],
  dict: ()=> state.activeDict ? state.profiles[state.activeProfile].dictionaries[state.activeDict] : null,
  dicts: ()=> state.profiles[state.activeProfile].dictionaries,
  songs: ()=> state.profiles[state.activeProfile].songs,
  notes: ()=> state.profiles[state.activeProfile].notes,
  song: ()=> state.activeSong ? state.profiles[state.activeProfile].songs[state.activeSong] : null,
  note: ()=> state.activeNote ? state.profiles[state.activeProfile].notes[state.activeNote] : null,
};

function jsonField(value, fallback){
  try{ return value ? JSON.parse(value) : fallback; }catch(e){ return fallback; }
}
function linkedSources(profile, wordId){
  return linkedSourceIndex(profile).get(String(wordId))||[];
}
function linkedSourceIndex(profile){
  const index=new Map();
  for(const [type,items] of [['song',profile.songs],['note',profile.notes]]){
    for(const [id,item] of Object.entries(items||{})){
      const html=type==='song'?item.lyrics:item.content;
      if(!html||!String(html).includes('data-link')) continue;
      const box=document.createElement('div');
      box.innerHTML=cleanEditorHTML(html);
      box.querySelectorAll('.hl[data-link]').forEach(span=>{
        const key=String(span.dataset.link);
        if(!index.has(key)) index.set(key,[]);
        index.get(key).push({type,id,spanId:span.dataset.id||'',text:span.textContent.trim()});
      });
    }
  }
  return index;
}
function tableRows(profile){
  const dictionary=[];
  const linkIndex=linkedSourceIndex(profile);
  for(const d of Object.values(profile.dictionaries)){
    for(const w of Object.values(d.words)){
      dictionary.push({
        id:String(w.id), perfil:profile.name, idioma:d.name, carpeta:w.folder||'',
        palabra:w.phrase||'', traduccion:w.meaning||'', pronunciacion:w.pron||'',
        multimedia:w.media||'', tracker:JSON.stringify(w.studied||[]),
        enlaces:JSON.stringify(linkIndex.get(String(w.id))||[])
      });
    }
  }
  const songs=Object.values(profile.songs).map(s=>({
    id:String(s.id), perfil:profile.name, artista:s.artist||'', titulo:s.title||'',
    letra:s.lyrics||'', tracker:JSON.stringify(s.studied||[]),
    metadatos:JSON.stringify({createdAt:s.createdAt||Date.now()})
  }));
  const notebook=Object.values(profile.notes).map(n=>({
    id:String(n.id), perfil:profile.name, titulo:n.title||'Sin título',
    contenido:n.content||'', metadatos:JSON.stringify({createdAt:n.createdAt||Date.now(),folder:n.folder||'',folders:profile.notebookFolders||[]})
  }));
  return {diccionario:dictionary,canciones:songs,cuaderno:notebook};
}
function applyExcelRows(profile, data){
  if(data.diccionario.length){
    const dictionaries=Object.fromEntries(Object.entries(profile.dictionaries).map(([id,d])=>[
      id,{...d,folders:[...(d.folders||[])],words:{...d.words}}
    ]));
    for(const row of data.diccionario){
      if(!row.palabra) continue;
      const name=row.idioma||'Diccionario';
      let dict=Object.values(dictionaries).find(d=>d.name===name);
      if(!dict){
        dict=newDict(name);
        dictionaries[dict.id]=dict;
      }
      const word={
        id:String(row.id||uid()), phrase:row.palabra||'', meaning:row.traduccion||'',
        pron:row.pronunciacion||'', media:row.multimedia||'', folder:row.carpeta||'',
        studied:jsonField(row.tracker,[]), links:jsonField(row.enlaces,[]),
        createdAt:Number(row.createdAt)||Date.now()
      };
      if(word.folder && !dict.folders.includes(word.folder)) dict.folders.push(word.folder);
      dict.words[word.id]=word;
    }
    profile.dictionaries=dictionaries;
  }
  if(data.canciones.length){
    const songs={...profile.songs};
    for(const row of data.canciones){
      const meta=jsonField(row.metadatos,{});
      const songId=String(row.id||uid());
      songs[songId]={
        id:songId,artist:row.artista||'',title:row.titulo||'',
        lyrics:row.letra||'',studied:jsonField(row.tracker,[]),createdAt:meta.createdAt||Date.now()
      };
    }
    profile.songs=songs;
  }
  if(data.cuaderno.length){
    const notes={...profile.notes};
    for(const row of data.cuaderno){
      const meta=jsonField(row.metadatos,{});
      const noteId=String(row.id||uid());
      notes[noteId]={
        id:noteId,title:row.titulo||'Sin título',
        content:row.contenido||'',folder:meta.folder||'',createdAt:meta.createdAt||Date.now()
      };
      if(meta.folder && !profile.notebookFolders.includes(meta.folder)) profile.notebookFolders.push(meta.folder);
      for(const folder of meta.folders||[]) if(!profile.notebookFolders.includes(folder)) profile.notebookFolders.push(folder);
    }
    profile.notes=notes;
  }
}
async function agregarPalabra(carpeta,palabra,definicion){
  const d=sel.dict();
  if(!d) return;
  const word=newWord({folder:carpeta,phrase:palabra,meaning:definicion});
  d.words[word.id]=word;
  invalidateDictionaryPhraseIndex();
  save(); renderAll();
}

function newDict(name, createFolder){
  return { id:uid(), name, folders:[], words:{}, createdAt:Date.now() };
}
function newProfile(name){
  return { id:uid(), name, dictionaries:{}, songs:{}, notes:{}, notebookFolders:[], createdAt:Date.now(), onboardingCompleted:false };
}
function newWord(f){
  const w = { id:uid(), phrase:f.phrase||'', meaning:f.meaning||'', pron:f.pron||'', media:f.media||'', folder:f.folder||'', studied:[], createdAt:Date.now() };
  return w;
}
function newSong(artist,title,lyrics){
  return { id:uid(), artist, title, lyrics: lyrics||'', studied:[], createdAt:Date.now() };
}
function songLyricsHTML(value){
  const lyrics=String(value||'');
  const hasEditorMarkup=/<(?:br|div|p|span|strong|em|u|ul|ol|li)\b[^>]*>/i.test(lyrics);
  if(hasEditorMarkup) return cleanEditorHTML(lyrics);
  return lyrics
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\r\n?|\n/g,'<br>');
}
function newNote(title, content){
  return { id:uid(), title: title||'Sin título', content: content||'', folder:'', createdAt:Date.now() };
}
function todayStr(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}

/* ---------- Colors ---------- */
const HL_COLORS = [
  {color:'#fde047', name:'Amarillo'},   // key
  {color:'#86efac', name:'Verde'},      // structure
  {color:'#93c5fd', name:'Azul'},       // vocab
  {color:'#f9a8d4', name:'Rosa'},       // grammar
  {color:'#fdba74', name:'Naranja'},    // idiom
  {color:'#d8b4fe', name:'Morado'},     // formality
];

/* ---------- Init / boot ---------- */
const ONBOARDING_STEPS=[
  {tab:'dictionary',title:'Tu diccionario',body:'Añade frases, traducciones y multimedia. Organiza carpetas, busca y filtra el vocabulario, marca repasos diarios y copia o borra varias frases.'},
  {tab:'songs',title:'Aprende con canciones',body:'Guarda artista, título y letra. Selecciona una frase para resaltarla, cambiar su tamaño, añadir una nota, enlazarla o enviarla al diccionario.'},
  {tab:'notebook',title:'Cuaderno personal',body:'Crea notas y subcarpetas. Selecciona texto para resaltarlo, crear notas vinculadas o conectar expresiones con tu diccionario y canciones.'},
  {tab:null,title:'Importa y respalda',body:'En el menú ⋯ puedes importar y exportar tus datos en un archivo Excel.'}
];
let onboardingIndex=0;
function onboardingSteps(){ return ONBOARDING_STEPS; }
function startOnboarding(){
  onboardingIndex=0;
  renderOnboardingStep();
  openModal('onboardingModal');
}
function renderOnboardingStep(){
  const steps=onboardingSteps(), step=steps[onboardingIndex];
  if(!step) return finishOnboarding();
  if(step.tab) switchTab(step.tab);
  document.getElementById('onboardingProgress').textContent=`Paso ${onboardingIndex+1} de ${steps.length}`;
  document.getElementById('onboardingTitle').textContent=step.title;
  document.getElementById('onboardingBody').textContent=step.body;
  document.getElementById('onboardingBack').classList.toggle('invisible',onboardingIndex===0);
  document.getElementById('onboardingNext').textContent=onboardingIndex===steps.length-1?'Empezar':'Siguiente';
}
function moveOnboarding(direction){
  const steps=onboardingSteps();
  if(direction>0 && onboardingIndex===steps.length-1) return finishOnboarding();
  onboardingIndex=Math.max(0,Math.min(steps.length-1,onboardingIndex+direction));
  renderOnboardingStep();
}
function finishOnboarding(){
  if(state.activeProfile && state.profiles[state.activeProfile]){
    state.profiles[state.activeProfile].onboardingCompleted=true;
    save();
  }
  closeModal('onboardingModal');
  switchTab('dictionary');
}
function skipOnboarding(){ finishOnboarding(); }
async function boot(){
  await initializePersistence();
  if(state.activeProfile===ADMIN_PROFILE_ID) state.activeProfile=null;
  renderProfiles();
  if(state.activeProfile && state.profiles[state.activeProfile]){
    enterApp();
  } else {
    document.getElementById('profileScreen').classList.remove('hidden');
    renderProfiles();
  }
}

function renderProfiles(){
  const list = document.getElementById('profileList');
  list.innerHTML = '';
  const entries = Object.entries(state.profiles).filter(([id])=>id!==ADMIN_PROFILE_ID);
  if(entries.length===0){
    list.innerHTML = '<div class="text-sm text-slate-400 text-center py-4">Aún no hay perfiles. Crea el primero.</div>';
    return;
  }
  for(const [id,p] of entries){
    const active = id===state.activeProfile;
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 p-3 rounded-xl border '+(active?'border-indigo-300 bg-indigo-50':'border-slate-200 hover:bg-slate-50')+' cursor-pointer';
    const nDicts = Object.keys(p.dictionaries).length;
    const nSongs = Object.keys(p.songs).length;
    row.innerHTML = `
      <div class="w-9 h-9 rounded-lg bg-indigo-500 text-white flex items-center justify-center font-bold">${esc(p.name[0]||'?').toUpperCase()}</div>
      <div class="flex-1 min-w-0">
        <div class="font-semibold truncate">${esc(p.name)}</div>
        <div class="text-xs text-slate-400">${nDicts} dicc · ${nSongs} canciones</div>
      </div>
      <div class="flex gap-1">
        ${active?'<button onclick="event.stopPropagation();enterApp()" class="text-xs bg-indigo-500 text-white rounded-lg px-3 py-1.5">Entrar</button>'
                :'<button onclick="event.stopPropagation();selectProfile(\''+id+'\')" class="text-xs bg-slate-800 text-white rounded-lg px-3 py-1.5">Usar</button>'}
        <button onclick="event.stopPropagation();deleteProfilePrompt(\''+id+'\')" class="text-xs text-red-400 px-2">🗑️</button>
      </div>`;
    row.onclick = ()=> selectProfile(id);
    list.appendChild(row);
  }
  if((!state.activeProfile || !state.profiles[state.activeProfile]) && entries.length){
    state.activeProfile = entries[0][0];
    save();
    renderProfiles();
  }
}
function createProfile(){
  const name = document.getElementById('newProfileName').value.trim();
  if(!name){ return toast('Escribe un nombre'); }
  if(Object.values(state.profiles).some(profile=>profile.name.toLocaleLowerCase()===name.toLocaleLowerCase())) return toast('Ese perfil ya existe');
  const p = newProfile(name);
  state.profiles[p.id] = p;
  if(!state.activeProfile || !state.profiles[state.activeProfile]) state.activeProfile = p.id;
  document.getElementById('newProfileName').value='';
  save(); renderProfiles();
  if(state.activeProfile===p.id) enterApp();
}
function selectProfile(id){
  if(id===ADMIN_PROFILE_ID) return;
  state.activeProfile = id;
  if(sel.dicts()[state.activeDict]===undefined) state.activeDict = null;
  if(sel.songs()[state.activeSong]===undefined) state.activeSong = null;
  if(sel.notes()[state.activeNote]===undefined) state.activeNote = null;
  activeNotebookFolder=sel.note()?.folder||'';
  save(); renderProfiles();
  document.getElementById('profileScreen').classList.add('hidden');
  enterApp();
}
function deleteProfilePrompt(id){
  if(id===ADMIN_PROFILE_ID) return;
  if(!confirm('¿Borrar el perfil '+ (state.profiles[id].name) +' y todos sus datos?')) return;
  if(!Object.prototype.hasOwnProperty.call(state.profiles, id)) return;
  delete state.profiles[id];
  if(state.activeProfile===id){ state.activeProfile=null; state.activeDict=null; state.activeSong=null; state.activeNote=null; }
  save(); renderProfiles();
  toast('Perfil eliminado');
}
function deleteActiveProfile(){
  dropMenu.hide();
  if(state.activeProfile===ADMIN_PROFILE_ID) return;
  setActiveDict(null); setActiveSong(null); setActiveNote(null); deleteProfilePrompt(state.activeProfile);
}

function enterApp(){
  const scr = document.getElementById('profileScreen');
  const app = document.getElementById('app');
  scr.classList.add('hidden'); app.classList.remove('hidden');
  activeNotebookFolder=sel.note()?.folder||'';
  // ensure default dict
  const d = sel.dicts();
  if(Object.keys(d).length && !d[state.activeDict]) state.activeDict = Object.keys(d)[0];
  syncSidebar();
  renderAll();
  if(sel.profile().onboardingCompleted){
    const savedTab=storageGet(ACTIVE_TAB_KEY,'dictionary');
    switchTab(VALID_TABS.includes(savedTab)?savedTab:'dictionary');
  }
  perfilActual=sel.profile().name;
  try{
    storageSet('perfil_activo',perfilActual);
    storageSet('perfil_activo_id',state.activeProfile);
  }catch(e){}
  if(!sel.profile().onboardingCompleted) startOnboarding();
}
function openSettings(){
  document.getElementById('settingsProfileName').textContent=sel.profile()?.name||'—';
  openModal('settingsModal');
}
function closeSettings(){ closeModal('settingsModal'); }
function toggleProfiles(){
  saveCurrentEditors();
  save();
  state.activeProfile = null; state.activeDict=null; state.activeSong=null; state.activeNote=null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('profileScreen').classList.remove('hidden');
  renderProfiles();
}

/* ---------- Sidebar ---------- */
function syncSidebar(){
  const p = sel.profile();
  document.getElementById('deleteProfileMenuItem').classList.toggle('hidden',p.id===ADMIN_PROFILE_ID);
  document.getElementById('profileNameSidebar').textContent = p.name;
  document.getElementById('profileNameMobile').textContent = p.name;
  document.getElementById('profileNameMob').textContent = p.name;
  document.getElementById('profileStats').textContent = Object.keys(p.dictionaries).length+' dicc';
  const init = p.name[0]||'?';
  ['avatarInitial','avatarInitialMobile','avatarInitialMob'].forEach(id=>document.getElementById(id).textContent=init.toUpperCase());
  renderStudySummary();
}
function renderStudySummary(){
  const d = sel.dict();
  const el = document.getElementById('studySummary');
  if(!d){ el.innerHTML='<div class="text-sm font-medium">Crea un diccionario para comenzar</div>'; return; }
  const words = Object.values(d.words);
  const today = todayStr();
  const studied = words.filter(w=>(w.studied||[]).includes(today)).length;
  el.innerHTML = `<div class="text-sm font-medium">🔥 Constancia hoy</div>
    <div class="text-2xl font-bold">${studied}<span class="text-base font-normal text-indigo-400">/${words.length}</span></div>
    <div class="text-xs text-indigo-500 mt-1">frases estudiadas</div>`;
}
const dropMenu = {
  el: ()=>document.getElementById('menuDots'),
  toggle(){ this.el().classList.toggle('hidden'); },
  hide(){ this.el().classList.add('hidden'); }
};
document.addEventListener('click',(e)=>{
  if(!e.target.closest('#menuDots') && !e.target.closest('#profileNameSidebar') && !e.target.closest('[onclick*="dropMenu"]')) dropMenu.hide();
});

/* ---------- Dictionaries ---------- */
function renderDictList(){
  const d = sel.dicts();
  const targets = {
    sidebar: document.getElementById('dictList'),
    mobile: document.getElementById('dictListMobile'),
    mobile2: document.getElementById('dictListMobile2'),
  };
  for(const key in targets){
    const el = targets[key];
    el.innerHTML='';
    for(const [id,dd] of Object.entries(d)){
      const n = Object.keys(dd.words).length;
      const div = document.createElement('div');
      div.className = 'dict-item group flex items-center gap-2 p-2 rounded-lg border border-transparent cursor-pointer hover:bg-slate-50 '+(id===state.activeDict?'active':'');
      div.innerHTML = `
        <div class="flex-1 min-w-0">
          <div class="font-medium text-slate-800 text-sm truncate">${esc(dd.name)} <span class="text-slate-400 text-xs">(${n})</span></div>
        </div>
        <button onclick="event.stopPropagation();deleteDictionary('${id}')" aria-label="Eliminar diccionario ${escAttr(dd.name)}" title="Eliminar diccionario" class="text-slate-300 hover:text-red-500 px-1">🗑️</button>
        <button onclick="event.stopPropagation();editDictMenu(this,'${id}')" class="text-slate-300 hover:text-indigo-600 invisible group-hover:visible">⋯</button>`;
      div.onclick = ()=>{ setActiveDict(id); };
      el.appendChild(div);
    }
    if(!Object.keys(d).length){
      el.innerHTML='<div class="text-sm text-slate-400 text-center py-3">Sin diccionarios</div>';
    }
  }
}
function deleteDictionary(id){
  const dict=sel.dicts()?.[id];
  if(!dict) return;
  const count=Object.keys(dict.words||{}).length;
  if(!confirm(`¿Eliminar el diccionario "${dict.name}" y sus ${count} frases?`)) return;
  saveCurrentEditors();
  delete sel.dicts()[id];
  invalidateDictionaryPhraseIndex();
  if(state.activeDict===id) state.activeDict=Object.keys(sel.dicts())[0]||null;
  save();
  renderDictList();
  renderAll();
  toast('Diccionario eliminado');
}
function editDictMenu(btn,id){
  dropMenu.hide();
  const go = (action)=>{
    if(action==='rename'){
      const name = prompt('Nuevo nombre del diccionario:', sel.dicts()[id].name);
      if(name && name.trim()){ sel.dicts()[id].name=name.trim(); save(); renderDictList(); renderAll(); toast('Renombrado'); }
    } else if(action==='addfolder'){
      const f = prompt('Nombre de la nueva carpeta:');
      if(f && f.trim()){ if(!sel.dicts()[id].folders.includes(f.trim())) sel.dicts()[id].folders.push(f.trim()); save(); renderDictList(); renderAll(); toast('Carpeta creada'); }
    } else if(action==='renamefolder'){
      const dict=sel.dicts()[id];
      const folders=dict.folders||[];
      if(!folders.length) return toast('Este diccionario no tiene carpetas');
      const folder=prompt(`Carpeta para renombrar:\n${folders.join('\n')}`);
      if(folder&&folders.includes(folder.trim())) renameDictionaryFolder(folder.trim(),id);
    } else if(action==='delete'){
      if(confirm('¿Eliminar el diccionario?')){ delete sel.dicts()[id]; invalidateDictionaryPhraseIndex(); if(state.activeDict===id) setActiveDict(null); save(); renderDictList(); renderAll(); }
    }
  };
  // simple menu
  const a=prompt('Opciones para "'+sel.dicts()[id].name+'":\n1 Renombrar diccionario\n2 Añadir carpeta\n3 Eliminar diccionario\n4 Renombrar carpeta');
  if(a==='1')go('rename'); else if(a==='2')go('addfolder'); else if(a==='3')go('delete'); else if(a==='4')go('renamefolder');
}
function addDictModal(){
  document.getElementById('dictModalTitle').textContent='Nuevo diccionario';
  document.getElementById('dictName').value='';
  document.getElementById('dictFolderYes').checked=true;
  openModal('dictModal');
}
function saveDict(){
  const name = document.getElementById('dictName').value.trim();
  if(!name){ return toast('Escribe un nombre'); }
  const dd = newDict(name);
  if(document.getElementById('dictFolderYes').checked) dd.folders.push('General');
  sel.dicts()[dd.id]=dd;
  state.activeDict=dd.id;
  save(); renderDictList(); renderAll(); closeModal('dictModal');
  toast('Diccionario creado');
}
function openDictModal(){ addDictModal(); }
function closeDictModal(){ closeModal('dictModal'); }
function setActiveDict(id){
  saveCurrentEditors();
  // persist active dict selection in dicts words? default folders if none
  if(id===null){ state.activeDict=null; }
  else { state.activeDict=id; }
  save();
  renderAll();
}
function openModal(id){ document.getElementById(id).classList.remove('hidden'); document.getElementById(id).classList.add('flex'); }
function closeModal(id){ document.getElementById(id).classList.add('hidden'); document.getElementById(id).classList.remove('flex'); }
let pendingConfirmAction=null;
function openConfirm(message,action){
  document.getElementById('confirmMessage').textContent=message;
  pendingConfirmAction=action;
  openModal('confirmModal');
}
function closeConfirm(){ closeModal('confirmModal'); pendingConfirmAction=null; }
function runConfirmAction(){
  const action=pendingConfirmAction;
  closeConfirm();
  action?.();
}

/* ---------- Words ---------- */
let wordRenderRequest=0;
async function renderWords(){
  const request=++wordRenderRequest;
  const d = sel.dict();
  const list = document.getElementById('wordsList');
  const listScrollTop=list.parentElement.scrollTop;
  const expandedFolders=new Set([...list.querySelectorAll('details.word-folder-group[open]')].map(group=>group.dataset.folder||''));
  const empty = document.getElementById('wordsEmpty');
  const emptyText = document.getElementById('wordsEmptyText');
  if(!d){ 
    list.innerHTML='';
    document.getElementById('activeDictTitle').textContent='Sin diccionario';
    emptyText.textContent='Selecciona o crea un diccionario en el menú lateral.';
    empty.classList.remove('hidden'); return; 
  }
  const q = document.getElementById('wordSearch').value.trim();
  const fFold = document.getElementById('folderFilter').value;
  const fStudy = document.getElementById('studyFilter').value;
  const queryState=JSON.stringify([q,fFold,fStudy]);
  if(list.dataset.queryState!==queryState){
    list.dataset.queryState=queryState;
    list.dataset.page='1';
  }
  const today = todayStr();
  const allWords=Object.values(d.words);
  const words=[];
  const presentFolders=new Set(d.folders||[]);
  for(let index=0;index<allWords.length;index++){
    const word=allWords[index];
    if(word.folder) presentFolders.add(word.folder);
    if(q&&!phraseSearchMatches(word.phrase,q)&&!phraseSearchMatches(word.meaning,q)) continue;
    if(fFold&&word.folder!==fFold) continue;
    const studied=(word.studied||[]).includes(today);
    if(fStudy==='today'&&!studied) continue;
    if(fStudy==='not'&&studied) continue;
    words.push(word);
    if(index%4000===3999){
      await new Promise(resolve=>setTimeout(resolve,0));
      if(request!==wordRenderRequest) return;
    }
  }
  if(request!==wordRenderRequest) return;

  // folders filter options
  const ff = document.getElementById('folderFilter');
  const curFold = ff.value;
  ff.innerHTML='<option value="">Todas las carpetas</option>';
  for(const f of d.folders){ ff.innerHTML+=`<option value="${esc(f)}">${esc(f)}</option>`; }
  // add any folder present in words but not in list
  ff.innerHTML = ff.innerHTML + [...presentFolders].filter(f=>!d.folders.includes(f)).map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('');
  ff.value = curFold && [...ff.options].some(o=>o.value===curFold) ? curFold : '';

  const matchCount=words.length;
  emptyText.textContent = q||fFold||fStudy ? 'Sin resultados con los filtros.' : 'Este diccionario está vacío. Añade tu primera frase.';
  const has = matchCount>0;
  empty.classList.toggle('hidden', has);

  if(words.length<=12000) words.sort((a,b)=>(a.phrase||'').localeCompare(b.phrase||''));
  list.innerHTML='';
  const pageSize=200;
  const page=Number(list.dataset.page)||1;
  const visibleWords=words.slice(0,page*pageSize);
  const linkedIndex=linkedSourceIndex(sel.profile());
  const groupedWords=new Map();
  for(const word of visibleWords){
    const key=word.folder||'';
    if(!groupedWords.has(key)) groupedWords.set(key,[]);
    groupedWords.get(key).push(word);
  }
  const orderedGroups=[...groupedWords.entries()].sort((a,b)=>{
    if(a[0]==='General') return -1;
    if(b[0]==='General') return 1;
    return (a[0]||'Sin carpeta').localeCompare(b[0]||'Sin carpeta');
  });
  const folderBodies=new Map();
  for(const [folder,folderWords] of orderedGroups){
    const section=document.createElement('details');
    section.className='word-folder-group';
    section.dataset.folder=folder;
    section.open=expandedFolders.has(folder)||(!expandedFolders.size&&orderedGroups.length===1)||folder===fFold||!!q;
    const heading=document.createElement('summary');
    heading.className='word-folder-heading';
    const headingLabel=document.createElement('span');
    headingLabel.className='word-folder-label';
    headingLabel.textContent='📁 '+(folder||'Sin carpeta');
    const headingCount=document.createElement('span');
    headingCount.className='word-folder-count';
    headingCount.textContent=String(folderWords.length);
    heading.append(headingLabel,headingCount);
    const share=document.createElement('button');
    share.type='button';
    share.className='folder-rename-button';
    share.textContent='↗';
    share.title='Compartir frases de esta carpeta como texto';
    share.setAttribute('aria-label',`Compartir frases de ${folder||'Sin carpeta'}`);
    share.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      shareDictionaryFolder(folder);
    });
    heading.append(share);
    if(folder){
      const rename=document.createElement('button');
      rename.type='button';
      rename.className='folder-rename-button';
      rename.textContent='✏️';
      rename.title='Renombrar carpeta';
      rename.setAttribute('aria-label',`Renombrar carpeta ${folder}`);
      rename.addEventListener('click',event=>{
        event.preventDefault();
        event.stopPropagation();
        renameDictionaryFolder(folder);
      });
      const remove=document.createElement('button');
      remove.type='button';
      remove.className='folder-delete-button';
      remove.textContent='🗑️';
      remove.title='Eliminar carpeta';
      remove.setAttribute('aria-label',`Eliminar carpeta ${folder}`);
      remove.addEventListener('click',event=>{
        event.preventDefault();
        event.stopPropagation();
        deleteDictionaryFolder(folder);
      });
      heading.append(rename,remove);
    }
    const body=document.createElement('div');
    body.className='word-folder-entries divide-y divide-slate-100';
    section.append(heading,body);
    list.appendChild(section);
    folderBodies.set(folder,body);
  }
  for(const w of visibleWords){
    const studied = (w.studied||[]).includes(today);
    const streak = getStreak(w);
    const sources=linkedIndex.get(String(w.id))||[];
    const sourceMarkup=sources.map(source=>{
      const item=source.type==='song'?sel.songs()[source.id]:sel.notes()[source.id];
      const label=source.type==='song'
        ? `SONGS · ${item?.artist||''} — ${item?.title||''}`
        : `CUADERNO · ${item?.title||'Sin título'}`;
      return `<button class="linked-source flex w-full items-center gap-2 mt-1 pl-2 py-1 text-left text-xs text-violet-700 hover:text-violet-900 dark:text-violet-300" onclick="navigateToSource('${source.type}','${source.id}','${source.spanId}')"><span class="font-bold">${esc(label)}</span><span class="truncate opacity-80">“${esc(source.text)}”</span><span class="ml-auto shrink-0">Ir ↗</span></button>`;
    }).join('');
    const detectedMarkup=esc(w.phrase);
    const row = document.createElement('div');
    row.className='flex items-start gap-3 p-3 hover:bg-slate-50 transition cursor-default';
    row.dataset.wordId=w.id;
    row.innerHTML = `
      <input type="checkbox" class="word-check mt-1.5 rounded text-indigo-500" data-id="${w.id}" title="Seleccionar para copiar/borrar"/>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-bold text-slate-800">${detectedMarkup}</span>
          ${w.folder&&w.folder!=='General'?`<span class="text-xs bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">📁 ${esc(w.folder)}</span>`:''}
          ${w.pron?`<span class="text-sm text-slate-400 italic">${esc(w.pron)}</span>`:''}
        </div>
        <div class="text-slate-600 mt-0.5">${esc(w.meaning)}</div>
        ${sourceMarkup?`<div class="mt-2">${sourceMarkup}</div>`:''}
        ${w.media?`<a href="${escAttr(w.media)}" target="_blank" rel="noopener" class="inline-block text-xs text-indigo-500 hover:underline mt-1">▶️ Reproducir multimedia</a>`:''}
        <div class="text-xs text-slate-400 mt-1">🔥 Rach: <span class="font-semibold text-orange-500">${streak}${streak===1?' día':' días'}</span></div>
      </div>
      <div class="flex flex-col items-end gap-1">
        <button onclick="studyToday('${w.id}')" class="text-xs rounded-lg px-2 py-1 font-medium ${studied?'bg-green-100 text-green-700':'bg-slate-100 text-slate-500 hover:bg-green-100 hover:text-green-700'}">${studied?'✓ Estudiado hoy':'Marcar estudiado'}</button>
        <div class="flex gap-1">
          <button onclick="editWord('${w.id}')" class="text-slate-400 hover:text-indigo-600" title="Editar">✏️</button>
          <button onclick="copyWord('${w.id}')" class="text-slate-400 hover:text-blue-600" title="Copiar">⧉</button>
          <button onclick="deleteWord('${w.id}')" class="text-slate-400 hover:text-red-600" title="Borrar">🗑️</button>
        </div>
      </div>`;
    row.querySelector('.word-check').addEventListener('change', updateCopyCount);
    folderBodies.get(w.folder||'')?.appendChild(row);
  }
  if(visibleWords.length<matchCount){
    const more=document.createElement('button');
    more.type='button';
    more.className='w-full px-4 py-4 text-sm font-semibold text-indigo-600 hover:bg-indigo-50';
    more.textContent=`Cargar más (${visibleWords.length} de ${matchCount})`;
    more.addEventListener('click',()=>{
      list.dataset.page=String(page+1);
      renderWords();
    });
    list.appendChild(more);
  }
  list.parentElement.scrollTop=listScrollTop;
  // Keep only a few hundred rows in the DOM even when the dictionary is large.
  document.getElementById('activeDictTitle').textContent = d.name + ` (${matchCount} frases)`;
}
function renameDictionaryFolder(oldName,dictId=state.activeDict){
  const dict=sel.dicts()?.[dictId];
  if(!dict||!oldName) return;
  const nextName=prompt('Nuevo nombre de la carpeta:',oldName)?.trim();
  if(!nextName||nextName===oldName) return;
  if((dict.folders||[]).includes(nextName)) return toast('Ya existe una carpeta con ese nombre');
  dict.folders=(dict.folders||[]).map(folder=>folder===oldName?nextName:folder);
  for(const word of Object.values(dict.words||{})){
    if(word.folder===oldName) word.folder=nextName;
  }
  if(dictId===state.activeDict&&document.getElementById('folderFilter').value===oldName) document.getElementById('folderFilter').value=nextName;
  save();
  if(dictId===state.activeDict) renderAll();
  else renderDictList();
  toast('Carpeta renombrada');
}
function deleteDictionaryFolder(name,dictId=state.activeDict){
  const dict=sel.dicts()?.[dictId];
  if(!dict||(dict.folders||[]).indexOf(name)<0) return;
  openConfirm(`¿Eliminar la carpeta "${name}"? Las frases se conservarán sin carpeta.`,()=>{
    dict.folders=(dict.folders||[]).filter(folder=>folder!==name);
    for(const word of Object.values(dict.words||{})){
      if(word.folder===name) word.folder='';
    }
    if(dictId===state.activeDict&&document.getElementById('folderFilter').value===name) document.getElementById('folderFilter').value='';
    save();
    if(dictId===state.activeDict) renderAll();
    else renderDictList();
    toast('Carpeta eliminada');
  });
}
function getStreak(w){
  let streak=0;
  const set = new Set(w.studied||[]);
  const d = new Date();
  // if not studied today, start checking from yesterday for continuity still counts last streak
  if(!set.has(todayStr())) d.setDate(d.getDate()-1);
  while(set.has(d.toISOString().slice(0,10))){ streak++; d.setDate(d.getDate()-1); }
  return streak;
}
function studyToday(id){
  const w = sel.dict().words[id];
  if(!w) return;
  const today = todayStr();
  const i = w.studied.indexOf(today);
  if(i>=0) w.studied.splice(i,1); else w.studied.push(today);
  save(); renderWords(); renderStudySummary(); syncSidebar();
}
function currentSelectionIds(){
  return [...document.querySelectorAll('.word-check:checked')].map(c=>c.dataset.id);
}
function updateCopyCount(){
  const c = currentSelectionIds().length;
  document.getElementById('copyCount').textContent = c+' seleccionadas';
}
function deleteSelected(){
  saveCurrentEditors();
  const ids = currentSelectionIds();
  if(!ids.length){ return toast('Selecciona frases primero'); }
  if(!confirm(`¿Borrar ${ids.length} frases?`)) return;
  const d = sel.dict();
  ids.forEach(id=>delete d.words[id]);
  invalidateDictionaryPhraseIndex();
  save(); renderAll(); toast('Frases eliminadas');
}
async function copyPlainText(text){
  const value=String(text||'').trim();
  if(!value) return false;
  try{
    await navigator.clipboard.writeText(value);
    return true;
  }catch(error){
    const input=document.createElement('textarea');
    input.value=value;
    input.setAttribute('readonly','');
    input.style.position='fixed';
    input.style.opacity='0';
    document.body.appendChild(input);
    input.select();
    const copied=document.execCommand('copy');
    input.remove();
    return copied;
  }
}
async function sharePlainText(text,title='Language Lab'){
  const value=String(text||'').trim();
  if(!value) return toast('No hay texto para compartir');
  if(typeof navigator.share==='function'){
    try{
      await navigator.share({title,text:value});
      return;
    }catch(error){
      if(error?.name==='AbortError') return;
    }
  }
  toast(await copyPlainText(value)?'Texto copiado; ya puedes pegarlo en otra app':'No se pudo copiar el texto');
}
async function copyFloatingSelection(){
  document.getElementById('hlMenu').classList.add('hidden');
  const copied=await copyPlainText(floatingShareText);
  toast(copied?'Texto copiado':'No se pudo copiar el texto');
}
function deleteFloatingSelection(){
  const editor=currentEditor()?.el;
  const range=pendingHighlightRange?.cloneRange();
  if(!editor||pendingSelectionEditor!==editor||!range||range.collapsed||!editor.contains(range.commonAncestorContainer)){
    return toast('Selecciona primero el texto que quieres eliminar');
  }
  const compact=value=>String(value||'').replace(/✦/g,'').replace(/\s+/g,' ').trim();
  if(compact(range.toString())===compact(editorTextWithoutBadges(editor))){
    document.getElementById('hlMenu').classList.add('hidden');
    return toast('Selecciona solo una parte del texto');
  }
  range.deleteContents();
  range.collapse(true);
  const selection=window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  if(hlTarget?.isConnected&&!hlTarget.textContent.trim()) hlTarget.remove();
  pendingHighlightRange=null;
  pendingSelectionText='';
  pendingSelectionEditor=null;
  floatingShareText='';
  hlTarget=null;
  document.getElementById('hlMenu').classList.add('hidden');
  saveCurrentEditors();
  save();
  const active=currentEditor();
  if(active) setTimeout(()=>applySmartMatches(active.el,active.key,active.key==='song'?state.activeSong:state.activeNote,true),0);
}
async function cutFloatingSelection(){
  if(!await copyPlainText(floatingShareText)) return toast('No se pudo copiar; el texto no se eliminó');
  deleteFloatingSelection();
}
function shareSelectedWords(){
  const ids=currentSelectionIds();
  if(!ids.length) return toast('Selecciona una o más frases para compartir');
  const dict=sel.dict();
  const lines=ids.map(id=>dict.words[id]).filter(Boolean).map(word=>word.phrase);
  void sharePlainText(lines.join('\n'),dict.name);
}
function shareDictionaryFolder(folder){
  const dict=sel.dict();
  const words=Object.values(dict?.words||{}).filter(word=>(word.folder||'')===folder);
  if(!words.length) return toast('Esta carpeta no tiene frases');
  words.sort((a,b)=>(a.phrase||'').localeCompare(b.phrase||''));
  const label=folder||'Sin carpeta';
  const lines=words.map(word=>word.phrase);
  void sharePlainText(lines.join('\n'),`${dict.name} · ${label}`);
}
function shareFilteredFolder(){
  const folder=document.getElementById('folderFilter').value;
  if(!folder) return toast('Elige una carpeta en el filtro');
  shareDictionaryFolder(folder);
}
function deleteWord(id){
  if(!confirm('¿Borrar esta frase?')) return;
  delete sel.dict().words[id];
  invalidateDictionaryPhraseIndex();
  save(); renderAll(); updateCopyCount();
}
function copyDictTo(){
  const ids = currentSelectionIds();
  if(!ids.length){ return toast('Selecciona frases para copiar'); }
  renderCopyModal();
  openModal('copyModal');
}
function copyWord(id){ 
  state.copySingle = [id]; 
  renderCopyModal(); openModal('copyModal'); 
}
function renderCopyModal(){
  const selEl = document.getElementById('copyDictSelect');
  selEl.innerHTML='';
  for(const [id,dd] of Object.entries(sel.dicts())){
    if(id===state.activeDict) continue;
    selEl.innerHTML+=`<option value="${id}">${esc(dd.name)}</option>`;
  }
  if(selEl.options.length===0) selEl.innerHTML='<option value="" disabled>No hay otros diccionarios</option>';
  updateCopyCount();
}
function closeCopyModal(){ closeModal('copyModal'); delete state.copySingle; }
function doCopy(){
  saveCurrentEditors();
  const targetId = document.getElementById('copyDictSelect').value;
  const move = document.getElementById('copyMove').checked;
  const ids = state.copySingle || currentSelectionIds();
  if(!targetId){ return toast('Elige un diccionario destino'); }
  const source = sel.dict();
  const target = sel.dicts()[targetId];
  let moved=0;
  for(const id of ids){
    if(!source.words[id]) continue;
    const copy = {...source.words[id], id:uid(), studied:[]};
    target.words[copy.id]=copy;
    if(move){ delete source.words[id]; }
    moved++;
  }
  if(move && ids.some(id=>source.words[id]===null && ids.length)){} // placeholder
  invalidateDictionaryPhraseIndex();
  delete state.copySingle;
  save(); closeModal('copyModal'); renderAll();
  toast(move?`${moved} frases movidas`:`${moved} frases copiadas`);
}
function openWordModal(id){
  state.editWordId = id||null;
  const editing = id ? sel.dict().words[id] : null;
  document.getElementById('wordModalTitle').textContent = editing?'Editar frase':'Añadir frase';
  document.getElementById('wPhrase').value = editing?editing.phrase:'';
  document.getElementById('wMeaning').value = editing?editing.meaning:'';
  document.getElementById('wPron').value = editing?editing.pron:'';
  document.getElementById('wMedia').value = editing?editing.media:'';
  renderWordFolders(editing?editing.folder:'');
  renderMediaPreview(editing?editing.media:'');
  openModal('wordModal');
  setTimeout(()=>document.getElementById('wPhrase').focus(),50);
}
function renderWordFolders(selected){
  const d = sel.dict();
  const el = document.getElementById('wFolder');
  const newFolder=document.getElementById('wFolderNew');
  el.innerHTML='<option value="" disabled>— Sin carpeta —</option>';
  const opts = d? d.folders : [];
  for(const f of opts){
    el.innerHTML+=`<option value="${esc(f)}">${esc(f)}</option>`;
  }
  el.innerHTML+='<option value="__new__">+ Nueva carpeta…</option>';
  el.value = opts.includes(selected) ? selected : '';
  newFolder.value='';
  newFolder.classList.add('hidden');
}
document.getElementById('wFolder').addEventListener('change',e=>{
  const field=document.getElementById('wFolderNew');
  const creating=e.target.value==='__new__';
  field.classList.toggle('hidden',!creating);
  if(creating) field.focus();
});
function renderMediaPreview(url){
  const box = document.getElementById('wMediaPrev');
  if(!url){ box.classList.add('hidden'); box.innerHTML=''; return; }
  let html='';
  if(/\.(mp4|webm|ogg)(\?|$)/i.test(url) || /video\//.test(url)) html=`<video src="${escAttr(url)}" controls class="w-full rounded-lg max-h-48"></video>`;
  else html=`<audio src="${escAttr(url)}" controls class="w-full"></audio>`;
  box.innerHTML=html;
  box.classList.remove('hidden');
}
document.getElementById('wMedia').addEventListener('input',e=>renderMediaPreview(e.target.value));
function saveWord(){
  saveCurrentEditors();
  const d = sel.dict();
  const phrase = document.getElementById('wPhrase').value.trim();
  if(!phrase){ return toast('La frase es obligatoria'); }
  const folderRaw = document.getElementById('wFolder').value;
  let folder = folderRaw;
  if(folderRaw==='__new__'){
    const nn=document.getElementById('wFolderNew').value.trim();
    if(!nn) return toast('Escribe el nombre de la carpeta');
    folder=nn;
    if(!d.folders.includes(folder)) d.folders.push(folder);
  }
  const data = {
    phrase,
    meaning: document.getElementById('wMeaning').value.trim(),
    pron: document.getElementById('wPron').value.trim(),
    media: document.getElementById('wMedia').value.trim(),
    folder: folder||'',
  };
  if(state.editWordId && d.words[state.editWordId]){
    Object.assign(d.words[state.editWordId], data);
    toast('Frase actualizada');
  } else {
    const w = newWord(data);
    d.words[w.id]=w;
    toast('Frase añadida');
  }
  invalidateDictionaryPhraseIndex();
  delete state.editWordId;
  document.getElementById('wFolderNew').value='';
  save(); closeModal('wordModal'); renderAll();
}
function editWord(id){ openWordModal(id); }
function closeWordModal(){ closeModal('wordModal'); delete state.editWordId; }

function saveCurrentEditors(){
  // current tab saving
  if(!state.activeProfile) return;
  const profile = state.profiles[state.activeProfile];
  if(!profile) return;
  if(sel.song() && document.getElementById('tab-songs').classList.contains('hidden')===false){
    sel.song().lyrics = cleanEditorHTML(document.getElementById('songEditor').innerHTML);
  }
  if(sel.note() && document.getElementById('tab-notebook').classList.contains('hidden')===false){
    sel.note().title = document.getElementById('nbTitle').value.trim()||'Sin título';
    sel.note().content = cleanEditorHTML(document.getElementById('nbEditor').innerHTML);
  }
}

/* =========================================================
   SONGS
   ========================================================= */
function renderSongList(){
  const songs = sel.songs();
  const el = document.getElementById('songList');
  const openArtists=new Set([...el.querySelectorAll('details[open]')].map(node=>node.dataset.artist));
  el.innerHTML='';
  const q = document.getElementById('songSearch').value.trim();
  let list = Object.entries(songs);
  if(q) list = list.filter(([id,s])=>
    phraseSearchMatches(`${s.artist||''} ${s.title||''}`,q)||phraseSearchMatches(sourceText('song',s),q)
  );
  const byArtist = {};
  for(const [id,s] of list){ const k=(s.artist||'Sin artista'); (byArtist[k]=byArtist[k]||[]).push([id,s]); }
  if(!list.length){ el.innerHTML='<div class=text-sm text-slate-400 text-center py-6>No hay canciones</div>'; return; }
  for(const artist in byArtist){
    const accordion=document.createElement('details');
    accordion.className='artist-accordion mb-1';
    accordion.dataset.artist=artist;
    accordion.open=openArtists.has(artist)||byArtist[artist].some(([id])=>id===state.activeSong);
    const summary=document.createElement('summary');
    summary.className='px-2 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-slate-500 hover:bg-slate-50 flex items-center gap-2';
    summary.innerHTML=`<span class="artist-chevron transition-transform">›</span><span>🎤 ${esc(artist)}</span><span class="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">${byArtist[artist].length}</span>`;
    summary.addEventListener('click',()=>{
      setTimeout(()=>{
        const selected=sel.song();
        if(selected && (selected.artist||'Sin artista')!==artist) setActiveSong(null);
      },0);
    });
    accordion.appendChild(summary);
    const songsWrap=document.createElement('div');
    songsWrap.className='pl-2';
    for(const [id,s] of byArtist[artist].sort((a,b)=>(a[1].title||'').localeCompare(b[1].title||''))){
      const btn=document.createElement('div');
      btn.className='song-item flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-indigo-50 border border-transparent '+(id===state.activeSong?'bg-indigo-50 border-indigo-200':'');
      const studied=(s.studied||[]).includes(todayStr());
      btn.innerHTML=`<span class="text-slate-400">♫</span><div class="flex-1 min-w-0"><div class="text-sm font-medium truncate">${esc(s.title)}</div></div>
        <label class="song-tracker inline-flex items-center p-1 cursor-pointer" title="${studied?'Estudiada hoy':'Marcar estudio de hoy'}" onclick="event.stopPropagation()"><input type="checkbox" ${studied?'checked':''} aria-label="Estudiada hoy" onchange="toggleSongStudy('${id}')"/></label>
        <button onclick="event.stopPropagation();songMenu('${id}')" class="text-slate-300 hover:text-red-500" title="Eliminar canción">🗑️</button>`;
      btn.onclick=()=>openSong(id);
      songsWrap.appendChild(btn);
    }
    accordion.appendChild(songsWrap);
    el.appendChild(accordion);
  }
}
function toggleSongStudy(id){
  const song=sel.songs()[id];
  if(!song) return;
  song.studied=song.studied||[];
  const today=todayStr(),index=song.studied.indexOf(today);
  if(index>=0) song.studied.splice(index,1); else song.studied.push(today);
  save(); renderSongList();
}
function songMenu(id){
  if(confirm('¿Eliminar esta canción?')){
    if(state.activeSong===id){ setActiveSong(null); }
    delete sel.songs()[id];
    save(); renderSongList(); renderAll();
  }
}
function openSongModal(){
  document.getElementById('songModalTitle').textContent='Nueva canción';
  document.getElementById('sArtist').value='';
  document.getElementById('sTitle').value='';
  document.getElementById('sLyrics').value='';
  resizeSongLyricsInput();
  openModal('songModal');
}
function saveSong(){
  const artist=document.getElementById('sArtist').value.trim();
  const title=document.getElementById('sTitle').value.trim();
  const lyrics=songLyricsHTML(document.getElementById('sLyrics').value);
  if(!artist||!title){ return toast('Indica artista y título'); }
  const s=newSong(artist,title,lyrics);
  sel.songs()[s.id]=s;
  state.activeSong=s.id;
  save(); closeModal('songModal'); renderSongList();
  openSong(s.id);
}
function closeSongModal(){ closeModal('songModal'); }
function resizeSongLyricsInput(){
  const input=document.getElementById('sLyrics');
  if(!input) return;
  input.style.height='auto';
  const min=window.matchMedia('(max-width: 767px)').matches?Math.round(window.innerHeight*.38):380;
  const max=Math.round(window.innerHeight*.68);
  input.style.height=`${Math.min(max,Math.max(min,input.scrollHeight))}px`;
}
function setActiveSong(id){
  saveCurrentEditors();
  state.activeSong=id;
  save(); renderAll();
}
function openSong(id){
  saveCurrentEditors();
  state.activeSong=id;
  save(); renderAll();
}

/* Shared selection actions for Songs and Cuaderno */
let pendingHighlightRange=null;
let menuPosition={x:20,y:80};
let linkQuickTarget=null;
let pendingSelectionText='';
let pendingSelectionEditor=null;
let floatingShareText='';
function showLinkQuickButton(span){
  if(!span?.isConnected||!span.dataset.link) return;
  linkQuickTarget=span;
  const button=document.getElementById('linkQuickButton');
  const rect=span.getBoundingClientRect();
  const size=window.matchMedia('(max-width: 767px)').matches?46:42;
  const top=Math.max(8,Math.min(window.innerHeight-size-8,rect.top+(rect.height-size)/2));
  button.style.top=`${top}px`;
  button.classList.remove('hidden');
}
function hideLinkQuickButton(){
  linkQuickTarget=null;
  document.getElementById('linkQuickButton').classList.add('hidden');
}
document.getElementById('linkQuickButton').addEventListener('click',event=>{
  event.preventDefault();
  event.stopPropagation();
  const span=linkQuickTarget;
  if(!span?.isConnected||!span.dataset.link){hideLinkQuickButton();return;}
  const rect=event.currentTarget.getBoundingClientRect();
  const range=document.createRange();
  range.selectNodeContents(span);
  pendingHighlightRange=range;
  pendingSelectionText=span.textContent.trim();
  pendingSelectionEditor=currentEditor()?.el||null;
  showHlMenu(span,rect.left-8,rect.bottom+6);
});
document.addEventListener('pointerover',event=>{
  const span=event.target.closest?.('.hl.badge');
  if(span) showLinkQuickButton(span);
});
document.addEventListener('selectionchange',()=>{
  if(!state.activeProfile) return;
  const selection=window.getSelection();
  if(!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range=selection.getRangeAt(0);
  const editor=currentEditor()?.el;
  if(!editor || !editor.contains(range.commonAncestorContainer)) return;
  const text=selection.toString().trim();
  if(!text) return;
  const allText=editorTextWithoutBadges(editor);
  const compact=value=>String(value||'').replace(/✦/g,'').replace(/\s+/g,' ').trim();
  if(compact(text)===compact(allText)){
    pendingHighlightRange=null;
    pendingSelectionText='';
    pendingSelectionEditor=null;
    hlTarget=null;
    document.getElementById('hlMenu').classList.add('hidden');
    return;
  }
  pendingHighlightRange=range.cloneRange();
  pendingSelectionText=text;
  pendingSelectionEditor=editor;
  const existing=range.commonAncestorContainer.nodeType===Node.ELEMENT_NODE
    ? range.commonAncestorContainer.closest('.hl')
    : range.commonAncestorContainer.parentElement?.closest('.hl');
  hlTarget=existing && editor.contains(existing) ? existing : null;
  const rect=range.getBoundingClientRect();
  hlTarget=existing && editor.contains(existing) ? existing : null;
  showHlMenu(hlTarget,rect.left+rect.width/2,rect.bottom+8);
});
function editorTextWithoutBadges(editor){
  const copy=editor.cloneNode(true);
  copy.querySelectorAll('.smart-badge').forEach(node=>node.remove());
  return copy.innerText||copy.textContent||'';
}
function currentEditor(){
  const songTab = !document.getElementById('tab-songs').classList.contains('hidden') && !document.getElementById('songEditorWrap').classList.contains('hidden');
  const nbTab = !document.getElementById('tab-notebook').classList.contains('hidden') && !document.getElementById('nbWrap').classList.contains('hidden');
  if(songTab) return { el:document.getElementById('songEditor'), key:'song' };
  if(nbTab) return { el:document.getElementById('nbEditor'), key:'note' };
  return null;
}
function buildColorBars(){
  // Highlight colors are now integrated into the contextual selection menu.
}
function highlightSelection(attrs){
  if(!ensureHlTarget()) return toast('Selecciona texto para resaltar');
  hlSetColor(attrs.color);
}
function renderHighlightSpans(ed){
  if(!ed) return;
  // re-attach click and badge visuals on spans
  ed.el.querySelectorAll('.hl').forEach(sp=>{
    sp.classList.toggle('badge', !!sp.dataset.link);
    sp.style.setProperty('--hl-color',sp.hasAttribute('data-color')?(sp.dataset.color||'transparent'):'#a5b4fc');
    sp.style.borderBottomColor=sp.dataset.color||'#a5b4fc';
    sp.style.borderBottomStyle=sp.hasAttribute('data-color')&&!sp.dataset.color?'none':'';
    sp.style.fontSize=sp.dataset.size==='med'?'1.35rem':(sp.dataset.size==='lg'?'1.7rem':'');
  });
}

/* Automatic phrase index shared by dictionary, songs and notebook */
function normalizePhrase(value){
  return String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/[’‘`]/g,"'").replace(/\s+/g,' ').trim();
}
const PHRASAL_PARTICLES=new Set(['about','across','after','along','around','aside','away','back','by','down','for','forward','in','into','off','on','onto','out','over','through','together','under','up']);
const IRREGULAR_VERB_FORMS={
  be:['am','is','are','was','were','been','being','soy','eres','es','somos','son','era','eras','éramos','eran','fui','fuiste','fue','fuimos','fueron','siendo'],
  have:['has','had','having','tengo','tienes','tiene','tenemos','tienen','tuve','tuviste','tuvo','tuvimos','tuvieron','teniendo'],
  do:['does','did','done','doing','hago','haces','hace','hacemos','hacen','hice','hiciste','hizo','hicimos','hicieron','haciendo'],
  go:['goes','went','gone','going','voy','vas','va','vamos','van','iba','ibas','íbamos','iban','fui','fuiste','fue','fuimos','fueron','yendo'],
  eat:['ate','eaten','eating','comí','comiste','comió','comimos','comieron','comiendo','como','comes','comemos','comen'],
  write:['wrote','written','writing','escribí','escribiste','escribió','escribimos','escribieron','escribiendo','escribe','escriben'],
  read:['reading','leyó','leyeron','leí','leíste','leímos','leyendo','lee','leen'],
  make:['made','making','hice','hiciste','hizo','hicimos','hicieron','haciendo'],
  see:['saw','seen','seeing','vi','viste','vio','vimos','vieron','viendo'],
  say:['says','said','saying','dije','dijiste','dijo','dijimos','dijeron','diciendo'],
  take:['takes','took','taken','taking','tomé','tomaste','tomó','tomamos','tomaron','tomando'],
  come:['comes','came','coming','vine','viniste','vino','vinimos','vinieron','viniendo'],
  get:['gets','got','gotten','getting'],
  give:['gives','gave','given','giving','di','diste','dio','dimos','dieron','dando'],
  think:['thinks','thought','thinking','pensé','pensaste','pensó','pensamos','pensaron','pensando'],
  know:['knows','knew','known','knowing','supe','supiste','supo','supimos','supieron','sabía','sabían'],
  find:['finds','found','finding','encontré','encontraste','encontró','encontramos','encontraron'],
  buy:['buys','bought','buying','compré','compraste','compró','compramos','compraron'],
  bring:['brings','brought','bringing','traje','trajiste','trajo','trajimos','trajeron'],
  teach:['teaches','taught','teaching','enseñé','enseñaste','enseñó','enseñamos','enseñaron'],
  speak:['speaks','spoke','spoken','speaking','hablé','hablaste','habló','hablamos','hablaron','hablando'],
  run:['runs','ran','running','corrí','corriste','corrió','corrimos','corrieron','corriendo'],
  become:['becomes','became','becoming'],
  begin:['begins','began','begun','beginning'],
  break:['breaks','broke','broken','breaking'],
  build:['builds','built','building'],
  catch:['catches','caught','catching'],
  choose:['chooses','chose','chosen','choosing'],
  cost:['costs','cost','costing'],
  cut:['cuts','cut','cutting'],
  draw:['draws','drew','drawn','drawing'],
  drink:['drinks','drank','drunk','drinking'],
  drive:['drives','drove','driven','driving'],
  fall:['falls','fell','fallen','falling'],
  feel:['feels','felt','feeling'],
  fight:['fights','fought','fighting'],
  fly:['flies','flew','flown','flying'],
  forget:['forgets','forgot','forgotten','forgetting'],
  freeze:['freezes','froze','frozen','freezing'],
  grow:['grows','grew','grown','growing'],
  hear:['hears','heard','hearing'],
  hide:['hides','hid','hidden','hiding'],
  hit:['hits','hit','hitting'],
  hold:['holds','held','holding'],
  hurt:['hurts','hurt','hurting'],
  keep:['keeps','kept','keeping'],
  lay:['lays','laid','laying'],
  lead:['leads','led','leading'],
  leave:['leaves','left','leaving'],
  lend:['lends','lent','lending'],
  lose:['loses','lost','losing'],
  mean:['means','meant','meaning'],
  meet:['meets','met','meeting'],
  pay:['pays','paid','paying'],
  put:['puts','put','putting'],
  ride:['rides','rode','ridden','riding'],
  ring:['rings','rang','rung','ringing'],
  rise:['rises','rose','risen','rising'],
  sell:['sells','sold','selling'],
  send:['sends','sent','sending'],
  set:['sets','set','setting'],
  shake:['shakes','shook','shaken','shaking'],
  shoot:['shoots','shot','shooting'],
  show:['shows','showed','shown','showing'],
  shut:['shuts','shut','shutting'],
  sing:['sings','sang','sung','singing'],
  sit:['sits','sat','sitting'],
  sleep:['sleeps','slept','sleeping'],
  spend:['spends','spent','spending'],
  stand:['stands','stood','standing'],
  steal:['steals','stole','stolen','stealing'],
  swim:['swims','swam','swum','swimming'],
  tell:['tells','told','telling'],
  throw:['throws','threw','thrown','throwing'],
  understand:['understands','understood','understanding'],
  wake:['wakes','woke','woken','waking'],
  wear:['wears','wore','worn','wearing'],
  win:['wins','won','winning'],
  poder:['puedo','puedes','puede','podemos','pueden','pude','pudiste','pudo','pudimos','pudieron','podía','podían','podré','podría'],
  querer:['quiero','quieres','quiere','queremos','quieren','quise','quisiste','quiso','quisimos','quisieron','quería','querían'],
  venir:['vengo','vienes','viene','venimos','vienen','vine','viniste','vino','vinieron','venía','venían'],
  salir:['salgo','sales','sale','salimos','salen','salí','saliste','salió','salieron','saliendo'],
  volver:['vuelvo','vuelves','vuelve','volvemos','vuelven','volví','volviste','volvió','volvieron','volviendo'],
  ser:['soy','eres','es','somos','son','era','eras','éramos','eran','fui','fuiste','fue','fuimos','fueron','siendo'],
  estar:['estoy','estás','está','estamos','están','estuve','estuviste','estuvo','estuvimos','estuvieron','estaba','estaban','estando'],
  hacer:['hago','haces','hace','hacemos','hacen','hice','hiciste','hizo','hicimos','hicieron','haciendo'],
  ir:['voy','vas','va','vamos','van','iba','ibas','íbamos','iban','fui','fuiste','fue','fuimos','fueron','yendo'],
  decir:['digo','dices','dice','decimos','dicen','dije','dijiste','dijo','dijimos','dijeron','diciendo'],
  ver:['veo','ves','ve','vemos','ven','vi','viste','vio','vimos','vieron','viendo'],
  dar:['doy','das','da','damos','dan','di','diste','dio','dimos','dieron','dando']
};
const VERB_LEMMAS=new Map();
for(const [lemma,forms] of Object.entries(IRREGULAR_VERB_FORMS)){
  for(const form of forms) VERB_LEMMAS.set(normalizePhrase(form).normalize('NFD').replace(/[\u0300-\u036f]/g,''),lemma);
}
function inflectedTokenKey(value){
  const original=normalizePhrase(value);
  const token=original.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const irregular=VERB_LEMMAS.get(token);
  if(irregular) return irregular;
  if(original.endsWith('ían')) return token.slice(0,-3);
  if(original.endsWith('ía')) return token.slice(0,-2);
  if(token.length<4) return token;
  if(token.endsWith('ies')&&token.length>5) return token.slice(0,-3)+'y';
  if(token.endsWith('ied')&&token.length>5) return token.slice(0,-3)+'y';
  if(token.endsWith('ing')&&token.length>6){
    const root=token.slice(0,-3);
    if(/(.)\1$/.test(root)) return root.slice(0,-1);
    return ['c','v','s'].includes(root.at(-1))?root+'e':root;
  }
  if(token.endsWith('ed')&&token.length>5){
    const root=token.slice(0,-2);
    return ['v','s','c','g'].includes(root.at(-1))?root+'e':root;
  }
  if(token.endsWith('as')&&token.length>5) return inflectedTokenKey(token.slice(0,-2));
  if(token.endsWith('ian')&&token.length>5){
    const withoutAn=token.slice(0,-2);
    return inflectedTokenKey(withoutAn.endsWith('i')?withoutAn:token.slice(0,-3));
  }
  if(token.endsWith('es')&&token.length>5){
    const root=token.slice(0,-2);
    if(/(?:s|x|z|ch|sh)$/.test(root)) return root;
    return token.slice(0,-1);
  }
  if(token.endsWith('s')&&token.length>4) return token.slice(0,-1);
  const spanishEndings=['ariamos','eriamos','iriamos','asteis','isteis','aron','ieron','ando','iendo','abas','abais','aban','aria','eria','iria','aste','iste','aba','ada','ido','ida','iendo','ias','ian','ais','eis','imos','emos','amos','are','ere','ire','ara','era','ira','as','es','an','en','os','ar','er','ir'];
  for(const ending of spanishEndings){
    if(token.endsWith(ending)&&token.length-ending.length>=3) return inflectedTokenKey(token.slice(0,-ending.length));
  }
  if(token.endsWith('io')&&token.length>4) return token.slice(0,-2);
  if(token.length>=5&&['o','a','e','i'].includes(token.at(-1))) return token.slice(0,-1);
  return token;
}
function phraseStructureKey(value){
  const tokens=phraseTokens(value).map(inflectedTokenKey);
  return canonicalPhraseTokens(tokens).join(' ');
}
function canonicalPhraseTokens(tokens){
  if(tokens.length>=3&&PHRASAL_PARTICLES.has(tokens[1])){
    return [tokens[0],tokens[1],...tokens.slice(2)];
  }
  if(tokens.length>=3&&PHRASAL_PARTICLES.has(tokens.at(-1))&&!PHRASAL_PARTICLES.has(tokens[1])){
    return [tokens[0],tokens.at(-1),...tokens.slice(1,-1)];
  }
  return tokens;
}
function phraseTenseKey(value){
  const expanded=expandInformalEnglish(value);
  const ignored=new Set([
    'i','you','he','she','it','we','they',
    'am','is','are','was','were','be','been','being',
    'have','has','had','do','does','did',
    'will','would','shall','should','can','could','may','might','must'
  ]);
  const tokens=phraseTokens(expanded)
    .map(inflectedTokenKey)
    .filter(token=>token&&!ignored.has(token));
  return canonicalPhraseTokens(tokens).join(' ');
}
function expandInformalEnglish(value){
  return String(value||'').toLowerCase()
    .replace(/[’‘`]/g,"'")
    // Common spoken forms and reductions.
    .replace(/\by'all'd've\b/g,'you all would have')
    .replace(/\by'all(?:'re|'ve|'ll|'d)?\b/g,match=>{
      if(match.endsWith("'re")) return 'you all are';
      if(match.endsWith("'ve")) return 'you all have';
      if(match.endsWith("'ll")) return 'you all will';
      if(match.endsWith("'d")) return 'you all would';
      return 'you all';
    })
    .replace(/\byall\b/g,'you all')
    .replace(/\b(ain't|aint)\b/g,'not')
    .replace(/\bimma\b/g,'i am going to')
    .replace(/\b(ima|finna)\b/g,'going to')
    .replace(/\bgonna\b/g,'going to')
    .replace(/\bwanna\b/g,'want to')
    .replace(/\bgotta\b/g,'got to')
    .replace(/\bhafta\b/g,'have to')
    .replace(/\bneedda\b/g,'need to')
    .replace(/\btryna\b/g,'trying to')
    .replace(/\bfinna\b/g,'going to')
    .replace(/\blet's\b/g,'let us')
    .replace(/\blemme\b/g,'let me')
    .replace(/\bgimme\b/g,'give me')
    .replace(/\bdunno\b/g,"don't know")
    .replace(/\b(whatcha|whatchu|watcha|wutcha)\b/g,'what you')
    .replace(/\bgotcha\b/g,'got you')
    .replace(/\bdidja\b/g,'did you')
    .replace(/\bwouldja\b/g,'would you')
    .replace(/\bcouldja\b/g,'could you')
    .replace(/\bdontcha\b/g,"don't you")
    .replace(/\b(will|would|could|should|might|must|can)n['’]?t['’]?ve\b/g,'$1 not have')
    .replace(/\b(i|you|he|she|it|we|they|there|what|where|who|when|why|how)'d've\b/g,'$1 would have')
    .replace(/\b(coulda|woulda|shoulda|mighta|musta)\b/g,match=>({
      coulda:'could have',woulda:'would have',shoulda:'should have',
      mighta:'might have',musta:'must have'
    })[match])
    .replace(/\b(kinda|sorta|outta|lotta)\b/g,match=>({
      kinda:'kind of',sorta:'sort of',outta:'out of',lotta:'lot of'
    })[match])
    .replace(/\b(c'?mon)\b/g,'come on')
    .replace(/\binnit\b/g,"isn't it")
    .replace(/\b'?twas\b/g,'it was')
    .replace(/\b'?tis\b/g,'it is')
    .replace(/\bne'er\b/g,'never')
    .replace(/\bo'er\b/g,'over')
    .replace(/\bem\b/g,'them')
    .replace(/\bya\b/g,'you')
    .replace(/\bcuz\b/g,'because')
    .replace(/\b'cause\b/g,'because')
    .replace(/\b(could|would|should|might|must) of\b/g,'$1 have')
    .replace(/\by'know\b/g,'you know')
    .replace(/\b(i)'m\b/g,'$1 am')
    .replace(/\b(you|he|she|it|we|they|there|here|what|where|who|when|why|how|that|this)'re\b/g,'$1 are')
    .replace(/\b(he|she|it|there|here|what|where|who|when|why|how|that|this)'s\b/g,'$1 is')
    .replace(/\b(i|you|he|she|it|we|they|there|what|where|who|when|why|how)'ve\b/g,'$1 have')
    .replace(/\b(i|you|he|she|it|we|they|there|what|where|who|when|why|how)'ll\b/g,'$1 will')
    .replace(/\b(i|you|he|she|it|we|they|there|what|where|who|when|why|how)'d\b/g,'$1 would')
    .replace(/\b(can|could|would|should|might|must|may)'ve\b/g,'$1 have')
    .replace(/\bshan't\b/g,'shall not')
    .replace(/\bwon't\b/g,'will not')
    .replace(/\bcan't\b/g,'can not')
    .replace(/n't\b/g,' not');
}
function phraseTokens(value){
  return String(value||'').match(/[\p{L}\p{N}]+(?:['’‘`-][\p{L}\p{N}]+)*/gu)||[];
}
function cleanEditorHTML(html){
  const box=document.createElement('div');
  box.innerHTML=html||'';
  box.querySelectorAll('.smart-badge').forEach(badge=>badge.remove());
  box.querySelectorAll('.smart-match,.hl.auto-match').forEach(span=>{
    const parent=span.parentNode;
    while(span.firstChild) parent.insertBefore(span.firstChild,span);
    parent.removeChild(span);
  });
  return box.innerHTML;
}
function sourceText(type,item){
  const field=type==='song'?'lyrics':'content';
  const raw=String(item[field]||'');
  const cached=sourceTextCache.get(item);
  if(cached?.raw===raw) return cached.text;
  const box=document.createElement('div');
  box.innerHTML=cleanEditorHTML(raw);
  const text=box.textContent||'';
  sourceTextCache.set(item,{raw,text});
  return text;
}
const sourceTextCache=new WeakMap();
function sourceLabel(source){
  const profile=sel.profile();
  if(source.type==='dict'){
    const dict=profile.dictionaries[source.dictId], word=dict?.words[source.wordId];
    return `Diccionario > ${dict?.name||'Diccionario'}${word?.folder?' > '+word.folder:''} > ${word?.phrase||''}`;
  }
  if(source.type==='song'){
    const song=profile.songs[source.id];
    return `Songs > ${song?.artist||'Sin artista'} > ${song?.title||'Canción'}`;
  }
  const note=profile.notes[source.id];
  const path=(note?.folder||'').split('/').filter(Boolean);
  return `Cuaderno${path.length?' > '+path.join(' > '):''} > ${note?.title||'Sin título'}`;
}
function phraseOccurs(text,phrase){
  if(normalizePhrase(text).includes(normalizePhrase(phrase))) return true;
  const target=phraseStructureKey(phrase), targetCount=phraseTokens(phrase).length;
  const tenseTarget=phraseTenseKey(phrase);
  if(!target||targetCount<2) return false;
  const segments=String(text||'').split(/[\n.!?;:]+/);
  for(const segment of segments){
    const matches=[...segment.matchAll(/[\p{L}\p{N}]+(?:['’‘`-][\p{L}\p{N}]+)*/gu)];
    for(let start=0;start<matches.length;start++){
      for(let size=Math.max(2,targetCount-1);size<=Math.min(8,matches.length-start,targetCount+2);size++){
        const end=start+size-1;
        if(matches.slice(start,end).some((match,index)=>!/^\s*$/.test(segment.slice(match.index+match[0].length,matches[start+index+1].index)))) continue;
        const candidate=segment.slice(matches[start].index,matches[end].index+matches[end][0].length);
        if(phraseStructureKey(candidate)===target||(tenseTarget&&phraseTenseKey(candidate)===tenseTarget)) return true;
      }
    }
  }
  return false;
}
function phraseSearchMatches(value,query){
  const target=normalizePhrase(query), candidate=normalizePhrase(value);
  if(!target) return true;
  if(candidate.includes(target)) return true;
  const queryTokens=phraseTokens(target);
  if(queryTokens.length===1){
    return phraseTokens(candidate).some(token=>inflectedTokenKey(queryTokens[0])===inflectedTokenKey(token));
  }
  const structure=phraseStructureKey(target), tense=phraseTenseKey(target);
  return (!!structure&&phraseStructureKey(value)===structure)||
    (!!tense&&phraseTenseKey(value)===tense)||phraseOccurs(value,target);
}
function dictionaryPhraseIndexes(){
  const profileId=state.activeProfile;
  if(cachedDictionaryPhraseIndexes&&!dictionaryPhrasesDirty&&cachedDictionaryPhrasesProfile===profileId){
    return cachedDictionaryPhraseIndexes;
  }
  const profile=sel.profile();
  const indexes={
    phrases:[],
    byExact:new Map(),
    byStructure:new Map(),
    byTense:new Map(),
    sourcesByStructure:new Map(),
    sourcesByTense:new Map()
  };
  const seen=new Set();
  function* dictionaryWords(){
    for(const dictId in profile?.dictionaries||{}){
      const dict=profile.dictionaries[dictId];
      for(const wordId in dict.words||{}) yield {dictId,wordId,word:dict.words[wordId]};
    }
  }
  const iterator=dictionaryWords();
  const generation=++dictionaryIndexBuildGeneration;
  dictionaryIndexBuildingFor=profileId;
  cachedDictionaryPhraseIndexes=indexes;
  cachedDictionaryPhrasesProfile=profileId;
  dictionaryPhrasesDirty=false;
  const addWord=({dictId,wordId,word})=>{
    const phrase=String(word.phrase||'').trim();
    const exact=normalizePhrase(phrase);
    if(exact.length<2) return;
    const record={dictId,wordId,phrase};
    if(!indexes.byExact.has(exact)) indexes.byExact.set(exact,[]);
    indexes.byExact.get(exact).push(record);
    const structure=phraseStructureKey(phrase);
    if(!indexes.byStructure.has(structure)) indexes.byStructure.set(structure,phrase);
    if(!indexes.sourcesByStructure.has(structure)) indexes.sourcesByStructure.set(structure,[]);
    indexes.sourcesByStructure.get(structure).push(record);
    const tense=phraseTenseKey(phrase);
    if(tense){
      if(!indexes.byTense.has(tense)) indexes.byTense.set(tense,phrase);
      if(!indexes.sourcesByTense.has(tense)) indexes.sourcesByTense.set(tense,[]);
      indexes.sourcesByTense.get(tense).push(record);
    }
    if(!seen.has(exact)){ seen.add(exact); indexes.phrases.push(phrase); }
  };
  const buildChunk=()=>{
    if(generation!==dictionaryIndexBuildGeneration) return;
    const deadline=performance.now()+7;
    let next;
    do{
      next=iterator.next();
      if(!next.done) addWord(next.value);
    }while(!next.done&&performance.now()<deadline);
    if(next.done){
      cachedDictionaryPhrases=indexes.phrases;
      dictionaryIndexBuildingFor=null;
      requestAnimationFrame(()=>{
        const editor=currentEditor();
        if(editor) applySmartMatches(editor.el,editor.key,editor.key==='song'?state.activeSong:state.activeNote,true);
      });
    }else{
      setTimeout(buildChunk,0);
    }
  };
  setTimeout(buildChunk,0);
  return indexes;
}
function crossSourcesForPhrase(phrase){
  const key=normalizePhrase(phrase);
  if(!key) return [];
  const structure=phraseStructureKey(phrase);
  const tense=phraseTenseKey(phrase);
  const indexes=dictionaryPhraseIndexes(), results=[];
  const dictionaryMatches=new Map();
  for(const word of indexes.sourcesByStructure.get(structure)||[]) dictionaryMatches.set(word.dictId+':'+word.wordId,word);
  if(tense) for(const word of indexes.sourcesByTense.get(tense)||[]) dictionaryMatches.set(word.dictId+':'+word.wordId,word);
  if(!dictionaryMatches.size){
    for(const word of indexes.byExact.get(key)||[]) dictionaryMatches.set(word.dictId+':'+word.wordId,word);
  }
  for(const word of dictionaryMatches.values()){
    results.push({type:'dict',dictId:word.dictId,wordId:word.wordId});
  }
  const profile=sel.profile();
  for(const [id,song] of Object.entries(profile.songs||{})){
    if(phraseOccurs(sourceText('song',song),phrase)) results.push({type:'song',id});
  }
  for(const [id,note] of Object.entries(profile.notes||{})){
    if(phraseOccurs(sourceText('note',note),phrase)) results.push({type:'note',id});
  }
  return results;
}
function phrasesForIndex(currentType,currentId){
  const profile=sel.profile(), phrases=[];
  for(const [type,items,field] of [['song',profile.songs,'lyrics'],['note',profile.notes,'content']]){
    for(const [itemId,item] of Object.entries(items||{})){
      if(type===currentType&&itemId===currentId) continue;
      const raw=String(item[field]||'');
      if(!raw.includes('class="hl')&&!raw.includes("class='hl")) continue;
      const cached=highlightedPhraseCache.get(item);
      if(cached?.raw===raw){
        phrases.push(...cached.phrases);
        continue;
      }
      const box=document.createElement('div');
      box.innerHTML=cleanEditorHTML(raw)
        .replace(/<br\s*\/?>/gi,'\n')
        .replace(/<\/(?:div|p|li|h[1-6])\s*>/gi,'\n');
      const itemPhrases=[];
      box.querySelectorAll('.hl').forEach(span=>{
        const phrase=span.textContent.trim();
        if(normalizePhrase(phrase).length>1) itemPhrases.push(phrase);
      });
      highlightedPhraseCache.set(item,{raw,phrases:itemPhrases});
      phrases.push(...itemPhrases);
    }
  }
  return [...new Set(phrases)].sort((a,b)=>b.length-a.length);
}
const highlightedPhraseCache=new WeakMap();
function captureEditorCaret(editor){
  const selection=window.getSelection();
  if(!selection?.rangeCount || (selection.anchorNode!==editor&&!editor.contains(selection.anchorNode))) return null;
  const before=document.createRange();
  before.selectNodeContents(editor);
  before.setEnd(selection.anchorNode,selection.anchorOffset);
  const contents=before.cloneContents();
  contents.querySelectorAll('.smart-badge').forEach(node=>node.remove());
  return contents.textContent.length;
}
let liveMatchAnchor=null;
function hideLiveMatchPanel(){
  document.getElementById('liveMatchPanel').classList.add('hidden');
  liveMatchAnchor=null;
}
function positionLiveMatchPanel(){
  const panel=document.getElementById('liveMatchPanel');
  if(panel.classList.contains('hidden')||!liveMatchAnchor?.isConnected) return;
  const rect=liveMatchAnchor.getBoundingClientRect();
  const width=panel.offsetWidth||300,height=panel.offsetHeight||80,gap=10;
  let left=rect.right+gap;
  if(left+width>window.innerWidth-8) left=rect.left-width-gap;
  left=Math.max(8,Math.min(left,window.innerWidth-width-8));
  let top=rect.top;
  if(top+height>window.innerHeight-8) top=rect.bottom-height;
  top=Math.max(8,Math.min(top,window.innerHeight-height-8));
  panel.style.left=left+'px';
  panel.style.top=top+'px';
}
window.addEventListener('resize',positionLiveMatchPanel);
window.addEventListener('scroll',positionLiveMatchPanel,true);
function showLiveMatchPanel(span,matchPhrase,sources){
  const panel=document.getElementById('liveMatchPanel');
  const dictionarySource=sources.find(source=>source.type==='dict'&&
    sel.profile().dictionaries[source.dictId]?.words[source.wordId]);
  const dictionaryWord=dictionarySource
    ?sel.profile().dictionaries[dictionarySource.dictId].words[dictionarySource.wordId]
    :null;
  document.getElementById('liveMatchPanelPhrase').textContent=`“${dictionaryWord?.phrase||matchPhrase}”`;
  document.getElementById('liveMatchPanelSource').textContent=dictionarySource
    ?sourceLabel(dictionarySource)
    :sourceLabel(sources[0]);
  liveMatchAnchor=span;
  panel.classList.remove('hidden');
  positionLiveMatchPanel();
}
function moveCaretOutOfHighlight(editor,event){
  if(!['insertText','insertCompositionText','insertFromPaste','insertLineBreak','insertParagraph'].includes(event.inputType)) return;
  const selection=window.getSelection();
  if(!selection?.isCollapsed || !selection.rangeCount) return;
  const range=selection.getRangeAt(0);
  if(range.startContainer!==editor&&!editor.contains(range.startContainer)) return;
  const node=range.startContainer;
  const wrapper=node.nodeType===Node.ELEMENT_NODE
    ? node.closest('.hl,.live-smart-match')
    : node.parentElement?.closest('.hl,.live-smart-match');
  if(!wrapper || !editor.contains(wrapper)) return;
  const before=document.createRange();
  before.selectNodeContents(wrapper);
  before.setEnd(range.startContainer,range.startOffset);
  const contents=before.cloneContents();
  contents.querySelectorAll('.smart-badge').forEach(badge=>badge.remove());
  const currentOffset=contents.textContent.length;
  const wrapperContents=wrapper.cloneNode(true);
  wrapperContents.querySelectorAll('.smart-badge').forEach(badge=>badge.remove());
  if(currentOffset<(wrapperContents.textContent||'').length) return;
  let next=wrapper.nextSibling;
  if(next?.nodeType!==Node.TEXT_NODE){
    next=document.createTextNode('');
    wrapper.parentNode.insertBefore(next,wrapper.nextSibling);
  }
  const nextRange=document.createRange();
  nextRange.setStart(next,0);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
}
function restoreEditorCaret(editor,offset){
  if(offset===null || offset===undefined) return;
  const selection=window.getSelection(),walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT,{
    acceptNode(node){
      let parent=node.parentElement;
      while(parent&&parent!==editor){
        if(parent.classList.contains('smart-badge')) return NodeFilter.FILTER_REJECT;
        parent=parent.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let remaining=offset,last=null;
  while(walker.nextNode()){
    const node=walker.currentNode;
    last=node;
    if(remaining<=node.nodeValue.length){
      const range=document.createRange();
      range.setStart(node,remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining-=node.nodeValue.length;
  }
  const range=document.createRange();
  if(last) range.setStart(last,last.nodeValue.length);
  else range.setStart(editor,editor.childNodes.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
function applySmartMatches(editor,type,id,preserveCaret=false,allowLivePanel=false){
  if(!editor || (document.activeElement===editor&&!preserveCaret)) return;
  const caret=preserveCaret?captureEditorCaret(editor):null;
  const originalHTML=editor.innerHTML;
  const cleanedHTML=cleanEditorHTML(originalHTML);
  if(cleanedHTML!==originalHTML) editor.innerHTML=cleanedHTML;
  const phrases=phrasesForIndex(type,id);
  const dictionaryIndexes=dictionaryPhraseIndexes();
  if(!phrases.length&&!dictionaryIndexes.phrases.length){
    if(allowLivePanel) hideLiveMatchPanel();
    if(preserveCaret) restoreEditorCaret(editor,caret);
    return;
  }
  const phrasesByStructure=dictionaryIndexes.byStructure;
  for(const phrase of phrases){
    const key=phraseStructureKey(phrase);
    if(key&&!phrasesByStructure.has(key)) phrasesByStructure.set(key,phrase);
  }
  const phrasesByTense=dictionaryIndexes.byTense;
  for(const phrase of phrases){
    const key=phraseTenseKey(phrase);
    if(key&&!phrasesByTense.has(key)) phrasesByTense.set(key,phrase);
  }
  const sourcesByStructure=new Map();
  const sourcesByTense=new Map();
  const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT,{
    acceptNode(node){
      if(!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      let parent=node.parentElement;
      while(parent && parent!==editor){
        if(parent.matches('.smart-match,.hl,script,style')) return NodeFilter.FILTER_REJECT;
        parent=parent.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes=[];
  while(walker.nextNode()) nodes.push(walker.currentNode);
  const nodeStarts=new Map();
  for(const node of nodes){
    const before=document.createRange();
    before.selectNodeContents(editor);
    before.setEnd(node,0);
    nodeStarts.set(node,before.cloneContents().textContent.length);
  }
  let activeMatch=null;
  for(const node of nodes){
    const text=node.nodeValue;
    const tokens=[...text.matchAll(/[\p{L}\p{N}]+(?:['’‘`-][\p{L}\p{N}]+)*/gu)];
    if(tokens.length<2) continue;
    const hits=[];
    let start=0;
    while(start<tokens.length){
      let found=null;
      const maxSize=Math.min(6,tokens.length-start);
      for(let size=maxSize;size>=2;size--){
        const end=start+size-1;
        let separated=true;
        for(let index=start;index<end;index++){
          if(!/^\s*$/.test(text.slice(tokens[index].index+tokens[index][0].length,tokens[index+1].index))){
            separated=false;
            break;
          }
        }
        if(!separated) continue;
        const from=tokens[start].index;
        const to=tokens[end].index+tokens[end][0].length;
        const phrase=text.slice(from,to);
        const structure=phraseStructureKey(phrase);
        const tenseKey=phraseTenseKey(phrase);
        const exactPhrase=phrasesByStructure.get(structure);
        const knownPhrase=exactPhrase||phrasesByTense.get(tenseKey);
        if(!knownPhrase) continue;
        const isTenseMatch=!exactPhrase;
        const sourceKey=isTenseMatch?tenseKey:structure;
        const sourceCache=isTenseMatch?sourcesByTense:sourcesByStructure;
        let sources=sourceCache.get(sourceKey);
        if(!sources){
          sources=crossSourcesForPhrase(knownPhrase).filter(source=>!(source.type===type&&source.id===id));
          sourceCache.set(sourceKey,sources);
        }
        if(sources.length){ found={from,to,phrase,matchPhrase:knownPhrase,sources,size}; break; }
      }
      if(found){
        hits.push(found);
        start+=found.size;
      }else start++;
    }
    if(!hits.length) continue;
    const fragment=document.createDocumentFragment();
    let cursor=0;
    for(const hit of hits){
      if(hit.from>cursor) fragment.append(document.createTextNode(text.slice(cursor,hit.from)));
      const smart=document.createElement('span');
      smart.className='smart-match live-smart-match';
      smart.dataset.smartPhrase=hit.phrase;
      smart.dataset.matchPhrase=hit.matchPhrase;
      smart.dataset.smartSources=JSON.stringify(hit.sources);
      smart.tabIndex=0;
      smart.setAttribute('role','button');
      smart.setAttribute('aria-label',`${hit.phrase}: ver frases con estructura similar`);
      smart.append(document.createTextNode(hit.phrase));
      const badge=document.createElement('span');
      badge.className='smart-badge';
      badge.textContent='✦';
      badge.setAttribute('aria-hidden','true');
      smart.append(badge);
      fragment.append(smart);
      if(allowLivePanel&&caret!==null&&caret===nodeStarts.get(node)+hit.to){
        activeMatch={span:smart,phrase:hit.matchPhrase,sources:hit.sources};
      }
      cursor=hit.to;
    }
    if(cursor<text.length) fragment.append(document.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  }
  if(preserveCaret) restoreEditorCaret(editor,caret);
  if(allowLivePanel){
    if(activeMatch) showLiveMatchPanel(activeMatch.span,activeMatch.phrase,activeMatch.sources);
    else if(!document.getElementById('liveMatchPanel').classList.contains('hidden')) liveMatchAnchor=null;
    else hideLiveMatchPanel();
  }
}
function showSmartPopover(element){
  const pop=document.getElementById('smartPopover');
  const phrase=element.dataset.smartPhrase||element.textContent.replace('✦','').trim();
  let sources=[];
  try{ sources=JSON.parse(element.dataset.smartSources||'[]'); }catch(error){}
  if(!sources.length && element.dataset.wordId){
    sources=crossSourcesForPhrase(phrase).filter(source=>
      !(source.type==='dict'&&source.dictId===element.dataset.dictId&&source.wordId===element.dataset.wordId)
    );
  }
  pop.innerHTML=`<div class="font-semibold text-slate-700 mb-2">“${esc(phrase)}”</div>`;
  if(!sources.length){
    pop.insertAdjacentHTML('beforeend','<div class="text-xs text-slate-400">No hay otras ubicaciones.</div>');
  }else{
    const caption=document.createElement('div');
    caption.className='text-xs text-slate-500 mb-1';
    caption.textContent='Frases con estructura similar:';
    pop.append(caption);
    for(const source of sources){
      const button=document.createElement('button');
      button.type='button';
      button.className='smart-source-link flex items-center gap-2';
      const route=document.createElement('span');
      route.className='flex-1';
      route.textContent=sourceLabel(source);
      const action=document.createElement('span');
      action.className='shrink-0 font-semibold';
      action.textContent='Ir a la fuente ↗';
      button.append(route,action);
      button.addEventListener('click',()=>navigateToSmartSource(source,phrase));
      pop.append(button);
    }
  }
  pop.classList.remove('hidden');
  pop.setAttribute('aria-live','polite');
}
function navigateToSmartSource(source,phrase){
  closeHighlightSidebar();
  document.getElementById('smartPopover').classList.add('hidden');
  saveCurrentEditors();
  if(source.type==='dict'){
    setActiveDict(source.dictId);
    switchTab('dictionary');
    requestAnimationFrame(()=>{
      const row=document.querySelector(`[data-word-id="${CSS.escape(source.wordId)}"]`);
      row?.scrollIntoView({behavior:'smooth',block:'center'});
    });
    return;
  }
  if(source.type==='song') state.activeSong=source.id;
  else {state.activeNote=source.id;activeNotebookFolder=sel.notes()[source.id]?.folder||'';}
  save();
  switchTab(source.type==='song'?'songs':'notebook');
  renderAll();
  requestAnimationFrame(()=>{
    const editor=document.getElementById(source.type==='song'?'songEditor':'nbEditor');
    const match=[...editor.querySelectorAll('.smart-match,.hl')].find(node=>
      normalizePhrase(node.dataset.smartPhrase||node.textContent.replace('✦','').trim())===normalizePhrase(phrase));
    match?.scrollIntoView({behavior:'smooth',block:'center'});
  });
}
let smartPopoverTimer=null;
document.addEventListener('mouseover',event=>{
  const target=event.target.closest?.('.smart-match');
  if(target){
    clearTimeout(smartPopoverTimer);
    if(!target.classList.contains('live-smart-match')) showSmartPopover(target);
  }
});
document.addEventListener('mouseout',event=>{
  const target=event.target.closest?.('.smart-match');
  const related=event.relatedTarget;
  if(target&&!related?.closest?.('.smart-match')&&!related?.closest?.('#smartPopover')){
    smartPopoverTimer=setTimeout(()=>document.getElementById('smartPopover').classList.add('hidden'),220);
  }
});
document.getElementById('smartPopover').addEventListener('mouseenter',()=>clearTimeout(smartPopoverTimer));
document.getElementById('smartPopover').addEventListener('mouseleave',()=>{
  smartPopoverTimer=setTimeout(()=>document.getElementById('smartPopover').classList.add('hidden'),220);
});
document.addEventListener('focusin',event=>{
  const target=event.target.closest?.('.smart-match');
  if(target&&!target.classList.contains('live-smart-match')) showSmartPopover(target);
});
document.addEventListener('click',event=>{
  if(!event.target.closest('#smartPopover')&&!event.target.closest('.smart-match')) document.getElementById('smartPopover').classList.add('hidden');
});

/* floating menu */
let hlTarget = null;
function retainAutoMatch(span){
  if(!span?.dataset.autoMatch) return;
  span.classList.remove('auto-match');
  delete span.dataset.autoMatch;
}
function promoteAutoMatch(span){
  const phrase=span.dataset.smartPhrase||span.textContent.replace('✦','').trim();
  const promoted=document.createElement('span');
  promoted.className='hl auto-match';
  promoted.dataset.id=uid();
  promoted.dataset.size='normal';
  promoted.dataset.autoMatch='1';
  promoted.dataset.smartPhrase=phrase;
  promoted.dataset.matchPhrase=span.dataset.matchPhrase||phrase;
  promoted.dataset.smartSources=span.dataset.smartSources||'[]';
  promoted.textContent=phrase;
  span.replaceWith(promoted);
  hlTarget=promoted;
  renderHighlightSpans(currentEditor());
  return promoted;
}
function openLiveMatchMenu(smart){
  document.getElementById('smartPopover').classList.add('hidden');
  const promoted=promoteAutoMatch(smart);
  const range=document.createRange();
  range.selectNodeContents(promoted);
  pendingHighlightRange=range;
  pendingSelectionText=promoted.textContent.trim();
  pendingSelectionEditor=currentEditor()?.el||null;
  const rect=promoted.getBoundingClientRect();
  showHlMenu(promoted,rect.left+rect.width/2,rect.bottom+6);
}
function ensureHlTarget(){
  if(hlTarget?.isConnected){ retainAutoMatch(hlTarget); return true; }
  const range=pendingHighlightRange;
  const ed=currentEditor()?.el;
  if(!range || !ed || !ed.contains(range.commonAncestorContainer)) return false;
  const span=document.createElement('span');
  span.className='hl';
  span.dataset.size='normal';
  span.dataset.id=uid();
  try{
    range.surroundContents(span);
  }catch(error){
    const fragment=range.extractContents();
    span.appendChild(fragment);
    range.insertNode(span);
  }
  hlTarget=span;
  pendingHighlightRange=null;
  renderHighlightSpans(currentEditor());
  return true;
}
function closeHighlightSidebar(){
  document.getElementById('highlightSidebar').classList.remove('open');
  document.getElementById('highlightSidebar').setAttribute('aria-hidden','true');
  document.getElementById('highlightSidebarOverlay').classList.add('hidden');
}
function showHighlightSidebar(span){
  hlTarget=span;
  document.getElementById('hlMenu').classList.add('hidden');
  document.getElementById('smartPopover').classList.add('hidden');
  const drawer=document.getElementById('highlightSidebar');
  const phrase=span.textContent.trim();
  document.getElementById('highlightSidebarPhrase').textContent=phrase;
  document.getElementById('highlightSidebarNote').value=span.dataset.note||'';

  const editor=currentEditor();
  const currentType=editor?.key;
  const currentId=currentType==='song'?state.activeSong:state.activeNote;
  let matches=crossSourcesForPhrase(phrase).filter(source=>
    !(source.type===currentType&&source.id===currentId)
  );
  try{
    const linked=linkInfo(span.dataset.link);
    if(linked&&linked.type!=='dict'&&!matches.some(source=>source.type===linked.type&&source.id===linked.target)){
      matches.unshift({type:linked.type,id:linked.target,spanId:linked.spanId||''});
    }
  }catch(error){}
  const matchesBox=document.getElementById('highlightSidebarMatches');
  matchesBox.replaceChildren();
  if(!matches.length){
    const empty=document.createElement('p');
    empty.className='text-sm text-slate-400';
    empty.textContent='No se encontraron frases similares en otras secciones.';
    matchesBox.appendChild(empty);
  }else{
    for(const source of matches){
      const button=document.createElement('button');
      button.type='button';
      button.className='highlight-sidebar-match';
      button.textContent=sourceLabel(source);
      button.addEventListener('click',()=>{
        if(source.type==='dict') navigateToSmartSource(source,phrase);
        else navigateToSource(source.type,source.id,source.spanId||'');
      });
      matchesBox.appendChild(button);
    }
  }

  const colors=document.getElementById('highlightSidebarColors');
  colors.replaceChildren();
  const clear=document.createElement('button');
  clear.type='button';
  clear.className='highlight-color-swatch no-color';
  clear.title='Quitar color';
  clear.setAttribute('aria-label','Quitar color');
  clear.addEventListener('click',()=>hlSetColor(''));
  colors.appendChild(clear);
  for(const color of HL_COLORS){
    const swatch=document.createElement('button');
    swatch.type='button';
    swatch.className='highlight-color-swatch';
    swatch.style.backgroundColor=color.color;
    swatch.title=color.name;
    swatch.setAttribute('aria-label',color.name);
    swatch.addEventListener('click',()=>hlSetColor(color.color));
    colors.appendChild(swatch);
  }
  const links=document.getElementById('highlightSidebarLinks');
  links.replaceChildren();
  const info=span.dataset.link?linkInfo(span.dataset.link):null;
  if(info){
    const linked=document.createElement('div');
    linked.className='text-sm text-slate-500';
    linked.textContent=`Vinculada a ${info.label}`;
    links.appendChild(linked);
    const open=document.createElement('button');
    open.type='button';
    open.className='highlight-sidebar-match';
    open.textContent='Abrir vínculo ↗';
    open.addEventListener('click',hlOpenLink);
    links.appendChild(open);
    const unlink=document.createElement('button');
    unlink.type='button';
    unlink.className='drawer-action w-full text-red-600';
    unlink.textContent='Quitar vínculo';
    unlink.addEventListener('click',removeLink);
    links.appendChild(unlink);
  }else{
    const empty=document.createElement('p');
    empty.className='text-sm text-slate-400';
    empty.textContent='Esta frase todavía no tiene enlaces.';
    links.appendChild(empty);
  }
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden','false');
  document.getElementById('highlightSidebarOverlay').classList.remove('hidden');
}
function saveSidebarHighlightNote(){
  if(!hlTarget?.isConnected) return;
  const value=document.getElementById('highlightSidebarNote').value.trim();
  if(value) hlTarget.dataset.note=value;
  else delete hlTarget.dataset.note;
  hlTarget.dataset.hasnote=value?'1':'';
  hlTarget.title=value?'Nota: '+value:'';
  saveCurrentEditors();
  save();
  showHighlightSidebar(hlTarget);
  toast(value?'Nota guardada':'Nota eliminada');
}
function showHlMenu(span, x, y){
  hideLinkQuickButton();
  if(span) hlTarget = span;
  const activeEditor=currentEditor()?.el;
  const hasSelection=pendingSelectionEditor===activeEditor&&pendingHighlightRange&&!pendingHighlightRange.collapsed;
  floatingShareText=hasSelection?pendingSelectionText:(span?.textContent?.trim()||pendingSelectionText);
  ['hlCopySelection','hlCutSelection','hlDeleteSelection'].forEach(id=>
    document.getElementById(id).classList.toggle('hidden',!floatingShareText)
  );
  document.getElementById('hlShareSelection').classList.toggle('hidden',!floatingShareText);
  menuPosition={x,y};
  // colors
  const wrap = document.getElementById('hlMenuColors');
  wrap.innerHTML = '<button title="Sin subrayado" class="color-swatch w-6 h-6 rounded-full border border-slate-300 bg-white" onclick="hlSetColor(\'\')"></button>'
    + HL_COLORS.map(c=>`<button title="${c.name}" class="color-swatch w-6 h-6 rounded-full border border-slate-300 ${span?.dataset.color===c.color?'ring-2 ring-slate-600':''}" style="background:${c.color}" onclick="hlSetColor('${c.color}')"></button>`).join('');
  // badge
  const badge = document.getElementById('hlMenuBadge');
  document.getElementById('hlUnlinkButton').classList.toggle('hidden',!span?.dataset.link);
  badge.replaceChildren();
  if(span?.dataset.link){
    const info = linkInfo(span.dataset.link);
    const title=document.createElement('div');
    title.className='text-xs text-slate-500 px-1 mb-1 font-semibold';
    title.textContent='Vínculo:';
    badge.appendChild(title);
    if(info){
      const description=document.createElement('div');
      description.className='text-sm px-2 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg mb-1 flex items-start gap-1';
      description.textContent=`${info.icon} ${info.label}`;
      badge.appendChild(description);
      const open=document.createElement('button');
      open.className='w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-100 text-sm';
      open.textContent='👁 Ver conexión';
      open.addEventListener('click',hlOpenLink);
      badge.appendChild(open);
    }else{
      const missing=document.createElement('div');
      missing.className='text-xs text-slate-400';
      missing.textContent='El vínculo ya no existe.';
      badge.appendChild(missing);
    }
  }
  let smartSources=[];
  try{ smartSources=JSON.parse(span?.dataset.smartSources||'[]'); }catch(error){}
  if(smartSources.length){
    const dictionarySource=smartSources.find(source=>source.type==='dict'&&
      sel.profile().dictionaries[source.dictId]?.words[source.wordId]);
    const suggestedLink=document.getElementById('hlSuggestedLink');
    if(dictionarySource){
      const word=sel.profile().dictionaries[dictionarySource.dictId].words[dictionarySource.wordId];
      suggestedLink.textContent=`🔗 Enlazar con «${word.phrase}»`;
      suggestedLink.onclick=()=>applyLink('word:'+dictionarySource.wordId);
      suggestedLink.classList.remove('hidden');
    }else{
      suggestedLink.classList.add('hidden');
      suggestedLink.onclick=null;
    }
    const title=document.createElement('div');
    title.className='text-xs text-slate-500 px-1 mb-1 mt-2 font-semibold';
    title.textContent='Coincidencias registradas · Ver ruta:';
    badge.appendChild(title);
    for(const source of smartSources){
      const route=document.createElement('button');
      route.className='w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-100 text-xs text-indigo-600';
      route.textContent=`↗ ${sourceLabel(source)}`;
      route.addEventListener('click',()=>{
        document.getElementById('hlMenu').classList.add('hidden');
        navigateToSmartSource(source,span.dataset.smartPhrase||span.textContent.trim());
      });
      badge.appendChild(route);
    }
  }else{
    document.getElementById('hlSuggestedLink').classList.add('hidden');
    document.getElementById('hlSuggestedLink').onclick=null;
  }
  badge.className=badge.childNodes.length?'p-2 border-t border-slate-100':'hidden';
  const menu = document.getElementById('hlMenu');
  menu.classList.remove('hidden');
  // position
  const mw = menu.offsetWidth || 256;
  const mh = menu.offsetHeight || 240;
  let left=x+20;
  if(left+mw>window.innerWidth-8) left=x-mw-20;
  let top=y-Math.min(24,mh*.18);
  left=Math.max(8,Math.min(left,window.innerWidth-mw-8));
  top=Math.max(8,Math.min(top,window.innerHeight-mh-8));
  menu.style.left=left+'px'; menu.style.top=top+'px';
  // set current size check
}
function shareFloatingSelection(){
  document.getElementById('hlMenu').classList.add('hidden');
  void sharePlainText(floatingShareText,'Texto seleccionado');
}
function bindHighlightClicks(){
  // Delegated click handling below remains attached when editable HTML changes.
}
document.addEventListener('click',e=>{
  const smart=e.target.closest?.('.smart-match');
  if(smart){
    e.preventDefault();
    e.stopPropagation();
    if(smart.classList.contains('live-smart-match')){
      openLiveMatchMenu(smart);
    }else{
      document.getElementById('hlMenu').classList.add('hidden');
      showSmartPopover(smart);
    }
    return;
  }
  const span=e.target.closest?.('.hl');
  if(!span) return;
  e.preventDefault();
  e.stopPropagation();
  if(span.dataset.note){
    hideLinkQuickButton();
    showHighlightSidebar(span);
    return;
  }
  if(span.dataset.link){
    showLinkQuickButton(span);
    return;
  }
  const selectedRange=document.createRange();
  selectedRange.selectNodeContents(span);
  pendingHighlightRange=selectedRange;
  pendingSelectionText=span.textContent.trim();
  pendingSelectionEditor=currentEditor()?.el||null;
  const r=span.getBoundingClientRect();
  showHlMenu(span,r.left+r.width/2,r.bottom+6);
});
document.addEventListener('keydown',event=>{
  const smart=event.target.closest?.('.live-smart-match');
  if(smart&&(event.key==='Enter'||event.key===' ')){
    event.preventDefault();
    openLiveMatchMenu(smart);
  }
});
document.addEventListener('click',(e)=>{
  if(e.target.closest('#linkQuickButton')) return;
  if(!e.target.closest('#hlMenu') && !e.target.closest('.hl') && !e.target.closest('.smart-match')){
    const selection=window.getSelection();
    if(e.target.closest('.editor')&&selection&&!selection.isCollapsed&&selection.rangeCount) return;
    hideLinkQuickButton();
    const menu=document.getElementById('hlMenu');
    const wasOpen=!menu.classList.contains('hidden');
    menu.classList.add('hidden');
    if(wasOpen){
      const editor=currentEditor();
      if(editor) setTimeout(()=>applySmartMatches(editor.el,editor.key,editor.key==='song'?state.activeSong:state.activeNote),0);
    }
  }
});
function hlSetColor(color){
  if(!ensureHlTarget()) return;
  hlTarget.dataset.color=color||'';
  hlTarget.style.setProperty('--hl-color',color||'transparent');
  hlTarget.style.borderBottomColor=color||'#a5b4fc';
  hlTarget.style.borderBottomStyle=color?'':'none';
  saveCurrentEditorsFromSpan(); save();
  renderHighlightSpans(currentEditor());
  if(document.getElementById('highlightSidebar').classList.contains('open')) showHighlightSidebar(hlTarget);
  else showHlMenu(hlTarget, menuPosition.x, menuPosition.y);
  toast('Resaltado aplicado');
}
function hlSetSize(size){
  if(!ensureHlTarget()) return;
  hlTarget.dataset.size=size==='1rem'?'normal': (size==='1.35rem'?'med': (size==='1.7rem'?'lg':'normal'));
  hlTarget.style.fontSize = hlTarget.dataset.size==='med'?'1.35rem':(hlTarget.dataset.size==='lg'?'1.7rem':'');
  saveCurrentEditorsFromSpan(); save();
}
function hlRemove(){
  if(!ensureHlTarget()) return;
  // undecorate: wrap inner in plain, replace span
  const parent = hlTarget.parentNode;
  while(hlTarget.firstChild) parent.insertBefore(hlTarget.firstChild, hlTarget);
  parent.removeChild(hlTarget);
  document.getElementById('hlMenu').classList.add('hidden');
  closeHighlightSidebar();
  saveCurrentEditors(); save();
  toast('Resaltado eliminado');
}
function noteModal(){
  return hlTarget ? hlAddNote() : undefined;
}
function hlAddNote(){
  if(!ensureHlTarget()) return;
  document.getElementById('hlMenu').classList.add('hidden');
  document.getElementById('noteModalPhrase').textContent=hlTarget.textContent.trim();
  document.getElementById('noteModalText').value=hlTarget.dataset.note||'';
  openModal('noteModal');
  setTimeout(()=>document.getElementById('noteModalText').focus(),40);
}
function saveHighlightNote(){
  if(!hlTarget) return;
  const val=document.getElementById('noteModalText').value.trim();
  if(val) hlTarget.dataset.note=val;
  else delete hlTarget.dataset.note;
  hlTarget.dataset.hasnote=val?'1':'';
  hlTarget.title=val?'Nota: '+val:'';
  saveCurrentEditors(); save(); closeNoteModal();
  if(document.getElementById('highlightSidebar').classList.contains('open')) showHighlightSidebar(hlTarget);
  toast(val?'Nota guardada':'Nota eliminada');
}
function closeNoteModal(){ closeModal('noteModal'); }
function hlEditNote(){ hlAddNote(); }
function hlEditPhrase(){
  if(!ensureHlTarget()) return;
  document.getElementById('hlMenu').classList.add('hidden');
  document.getElementById('editHighlightText').value=hlTarget.textContent;
  openModal('editHighlightModal');
  setTimeout(()=>document.getElementById('editHighlightText').focus(),40);
}
function saveHighlightText(){
  if(!hlTarget) return;
  const text=document.getElementById('editHighlightText').value.trim();
  if(!text) return toast('La frase no puede quedar vacía');
  hlTarget.textContent=text;
  delete hlTarget.dataset.smartSources;
  delete hlTarget.dataset.smartPhrase;
  saveCurrentEditors(); save(); closeEditHighlight();
  if(document.getElementById('highlightSidebar').classList.contains('open')) showHighlightSidebar(hlTarget);
}
function closeEditHighlight(){ closeModal('editHighlightModal'); }
function hlLink(){
  if(!ensureHlTarget()) return;
  document.getElementById('hlMenu').classList.add('hidden');
  document.getElementById('linkSearch').value='';
  renderLinkResults('');
  openModal('linkModal');
}
function linkInfo(targetId){
  const profile = sel.profile();
  for(const [did,dd] of Object.entries(profile.dictionaries)){
    if(dd.words[targetId]) return { type:'dict', label:'📚 '+dd.name+': '+ (dd.words[targetId].phrase||''), icon:'📚', target:did };
  }
  for(const [type,items] of [['song',profile.songs],['note',profile.notes]]){
    for(const [id,item] of Object.entries(items)){
      const box=document.createElement('div');
      box.innerHTML=type==='song'?(item.lyrics||''):(item.content||'');
      const span=[...box.querySelectorAll('.hl')].find(node=>node.dataset.id===String(targetId));
      if(span){
        const label=type==='song'?`🎵 ${item.artist} – ${item.title}`:`📔 ${item.title||'Sin título'}`;
        return {type,label:`${label}: “${span.textContent.trim()}”`,icon:type==='song'?'🎵':'📔',target:id,spanId:String(targetId)};
      }
    }
  }
  return null;
}
function dictionaryTenseMatch(phrase){
  const tenseKey=phraseTenseKey(phrase);
  if(!tenseKey) return null;
  let best=null;
  const exact=normalizePhrase(phrase);
  const structure=phraseStructureKey(phrase);
  const indexes=dictionaryPhraseIndexes();
  for(const record of indexes.sourcesByTense.get(tenseKey)||[]){
    const dict=sel.profile().dictionaries[record.dictId];
    const rank=normalizePhrase(record.phrase)===exact?0:
      phraseStructureKey(record.phrase)===structure?1:2;
    if(!best||rank<best.rank){
      best={dictId:record.dictId,dictName:dict.name,wordId:record.wordId,phrase:record.phrase,rank};
    }
  }
  return best;
}
function navigateToSource(type,id,spanId){
  closeHighlightSidebar();
  saveCurrentEditors();
  if(type==='song') state.activeSong=id;
  else {state.activeNote=id;activeNotebookFolder=sel.notes()[id]?.folder||'';}
  save();
  switchTab(type==='song'?'songs':'notebook');
  renderAll();
  requestAnimationFrame(()=>{
    const editor=document.getElementById(type==='song'?'songEditor':'nbEditor');
    const span=[...editor.querySelectorAll('.hl')].find(node=>node.dataset.id===spanId);
    if(span){ span.scrollIntoView({behavior:'smooth',block:'center'}); }
  });
}
function renderLinkResults(q){
  q = q===undefined? document.getElementById('linkSearch').value : q;
  q=q.toLowerCase().trim();
  const el = document.getElementById('linkResults');
  el.innerHTML='';
  // dictionaries
  const profile = sel.profile();
  let results = [];
  for(const [did,dd] of Object.entries(profile.dictionaries)){
    for(const [wid,w] of Object.entries(dd.words)){
      results.push({ key:'word:'+wid, label:'📚 '+dd.name+' → '+w.phrase+(w.meaning?' · '+w.meaning:''), searchText:w.phrase, sort:(w.phrase||'') });
    }
  }
  for(const [sid,s] of Object.entries(profile.songs)){
    if(!s.lyrics) continue;
    const box=document.createElement('div');
    box.innerHTML=s.lyrics;
    box.querySelectorAll('.hl').forEach(span=>{
      results.push({key:'songhl:'+span.dataset.id,label:'🎵 '+s.artist+' – '+s.title+' ↦ “'+span.textContent.trim()+'”',searchText:span.textContent.trim(),sort:span.textContent.trim()});
    });
  }
  for(const [nid,n] of Object.entries(profile.notes)){
    if(!n.content) continue;
    const box=document.createElement('div');
    box.innerHTML=n.content;
    box.querySelectorAll('.hl').forEach(span=>{
      results.push({key:'notehl:'+span.dataset.id,label:'📔 Cuaderno – '+(n.title||'Sin título')+' ↦ “'+span.textContent.trim()+'”',searchText:span.textContent.trim(),sort:span.textContent.trim()});
    });
  }
  if(q) results = results.filter(r=>r.label.toLowerCase().includes(q)||phraseSearchMatches(r.searchText||'',q));
  const suggestion=hlTarget?dictionaryTenseMatch(hlTarget.textContent.trim()):null;
  let suggestionButton=null;
  if(suggestion){
    suggestionButton=document.createElement('button');
    suggestionButton.type='button';
    suggestionButton.className='w-full text-left px-3 py-2 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-800 text-sm font-semibold mb-2 dark:bg-indigo-950 dark:hover:bg-indigo-900 dark:text-indigo-200';
    suggestionButton.textContent=`✨ Sugerencia principal: ${suggestion.dictName} → «${suggestion.phrase}»`;
    suggestionButton.addEventListener('click',()=>applyLink('word:'+suggestion.wordId));
  }
  // current link at top if exists
  if(hlTarget && hlTarget.dataset.link){
    const li = linkInfo(hlTarget.dataset.link);
    if(li) el.innerHTML+=`<button class="w-full text-left px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm mb-1" onclick="linkCancel()">Vínculo actual: ${esc(li.label)}</button>`;
  }
  el.innerHTML += `<button class="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 text-sm text-slate-600 mb-2" data-none="1" onclick="applyLink('')">— Sin vínculo —</button>`;
  if(suggestionButton) el.insertBefore(suggestionButton,el.firstChild);
  if(!results.length){ el.insertAdjacentHTML('beforeend','<div class="text-slate-400 text-sm text-center py-6">Sin resultados</div>'); return; }
  for(const r of results.slice(0,50)){
    const b=document.createElement('button');
    b.className='w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 text-sm';
    b.innerHTML = hlTarget && hlTarget.dataset.link===r.key ? ('<span class="text-indigo-600">✓ </span>'+esc(r.label)) : esc(r.label);
    b.onclick=()=>applyLink(r.key);
    el.appendChild(b);
  }
}
function applyLink(key){
  if(!hlTarget) return;
  if(!key){ delete hlTarget.dataset.link; delete hlTarget.dataset.linktype; }
  else{
    hlTarget.dataset.link = key.replace(/^(word|songhl|notehl):/,'');
    hlTarget.dataset.linktype = key.startsWith('word')?'dict':(key.startsWith('notehl')?'note':'song');
  }
  renderHighlightSpans(currentEditor());
  saveCurrentEditors(); save();
  document.getElementById('hlMenu').classList.add('hidden');
  closeModal('linkModal');
  if(document.getElementById('highlightSidebar').classList.contains('open')) showHighlightSidebar(hlTarget);
  toast(key?'Frase vinculada':'Vínculo eliminado');
}
function linkCancel(){ document.getElementById('hlMenu').classList.add('hidden'); closeModal('linkModal'); }
function closeLinkModal(){ closeModal('linkModal'); }
function removeLink(){ applyLink(''); }
function hlOpenLink(){
  if(!hlTarget||!hlTarget.dataset.link) return;
  const li = linkInfo(hlTarget.dataset.link);
  document.getElementById('hlMenu').classList.add('hidden');
  if(!li){ return toast('El vínculo ya no existe'); }
  if(li.type==='dict'){
    const phrase = sel.profile().dictionaries[li.target].words[hlTarget.dataset.link];
    if(phrase) showLinkedWord(phrase,li.target);
  } else {
    navigateToSource(li.type,li.target,li.spanId);
  }
}
function showLinkedWord(word,dictId){
  closeHighlightSidebar();
  setActiveDict(dictId);
  switchTab('dictionary');
  requestAnimationFrame(()=>{
    const row=document.querySelector(`[data-word-id="${CSS.escape(word.id)}"]`);
    row?.scrollIntoView({behavior:'smooth',block:'center'});
  });
}
function hlSendToDict(){
  if(!hlTarget) return;
  retainAutoMatch(hlTarget);
  const text = hlTarget.textContent.trim();
  if(!text) return toast('Frase vacía');
  const d = sel.dict();
  if(!d){ return toast('Crea un diccionario primero'); }
  const folder = d.folders.includes('General')?'General':(d.folders[0]||'');
  const existing = Object.values(d.words).find(w=>w.phrase===text);
  const word = existing || newWord({phrase:text, meaning:'', pron:'', media:'', folder});
  if(!existing) d.words[word.id]=word;
  if(!existing) invalidateDictionaryPhraseIndex();
  // create a link badge
  hlTarget.dataset.link = word.id;
  hlTarget.dataset.linktype='dict';
  renderHighlightSpans(currentEditor());
  saveCurrentEditors(); save();
  document.getElementById('hlMenu').classList.add('hidden');
  toast(existing?('Enviado a '+ (existing.folder||d.name)):'Frase enviada al diccionario');
  renderWords();
}
function saveCurrentEditorsFromSpan(){
  const ed = currentEditor();
  if(ed) saveCurrentEditors();
}

/* =========================================================
   NOTEBOOK
   ========================================================= */
let activeNotebookFolder='';
function ensureNotebookFolderPaths(){
  const profile=sel.profile();
  profile.notebookFolders ||= [];
  for(const note of Object.values(profile.notes)){
    note.folder ||= '';
    const parts=note.folder.split('/').filter(Boolean);
    let path='';
    for(const part of parts){
      path=path?path+'/'+part:part;
      if(!profile.notebookFolders.includes(path)) profile.notebookFolders.push(path);
    }
  }
}
function renderNoteList(){
  const notes=sel.notes(), profile=sel.profile(), el=document.getElementById('noteList');
  const query=document.getElementById('notebookSearch')?.value.trim()||'';
  if(!query) ensureNotebookFolderPaths();
  const matchingNotes=query?Object.entries(notes).filter(([,note])=>
    phraseSearchMatches(note.title||'',query)||phraseSearchMatches(sourceText('note',note),query)
  ):null;
  const folders=[...profile.notebookFolders].sort((a,b)=>a.localeCompare(b));
  el.innerHTML='';
  const all=document.createElement('button');
  all.type='button';
  all.className='folder-nav-item '+(!activeNotebookFolder?'selected':'');
  all.textContent='📔 Todas las notas';
  all.onclick=()=>{activeNotebookFolder='';renderNoteList();};
  if(!query) el.appendChild(all);
  const renderNotes=(folder,parent)=>{
    (matchingNotes||Object.entries(notes))
      .filter(([,note])=>query||((note.folder||'')===folder))
      .sort((a,b)=>(b[1].createdAt||0)-(a[1].createdAt||0))
      .forEach(([id,n])=>{
        const div=document.createElement('div');
        div.className='notebook-note-row '+(id===state.activeNote?'active':'');
        div.style.marginLeft=(query&&n.folder?`${Math.min(n.folder.split('/').length,5)*12}px`:(folder?`${Math.min(folder.split('/').length,5)*12}px`:'0'));
        div.innerHTML=`<div class="flex items-center gap-2"><div class="flex-1 min-w-0 font-medium truncate">${esc(n.title||'Sin título')}</div>
          <button type="button" class="note-delete text-slate-300 hover:text-red-500" aria-label="Eliminar nota">🗑️</button></div>
          <div class="text-xs text-slate-400 mt-1">${query&&n.folder?`📁 ${esc(n.folder)} · `:''}${new Date(n.createdAt||Date.now()).toLocaleDateString()}</div>`;
        div.onclick=()=>openNote(id);
        div.querySelector('.note-delete').onclick=event=>{event.stopPropagation();deleteNote(id);};
        parent.appendChild(div);
      });
  };
  renderNotes('',el);
  const childrenOf=parent=>folders.filter(path=>{
    const slash=path.lastIndexOf('/');
    return (slash<0?'':path.slice(0,slash))===parent;
  }).sort((a,b)=>a.localeCompare(b));
  const appendFolders=(parent,container)=>{
    for(const path of childrenOf(parent)){
      const details=document.createElement('details');
      details.className='notebook-folder';
      details.open=path===activeNotebookFolder||activeNotebookFolder.startsWith(path+'/');
      const summary=document.createElement('summary');
      summary.classList.toggle('selected',path===activeNotebookFolder);
      const label=document.createElement('span');
      label.textContent='📁 '+path.split('/').at(-1);
      const rename=document.createElement('button');
      rename.type='button';
      rename.className='notebook-folder-rename';
      rename.textContent='✏️';
      rename.title='Renombrar carpeta';
      rename.setAttribute('aria-label',`Renombrar carpeta ${path}`);
      rename.addEventListener('click',event=>{
        event.preventDefault();
        event.stopPropagation();
        renameNotebookFolder(path);
      });
      const remove=document.createElement('button');
      remove.type='button';
      remove.className='notebook-folder-delete';
      remove.textContent='🗑️';
      remove.title='Eliminar carpeta';
      remove.setAttribute('aria-label',`Eliminar carpeta ${path}`);
      remove.addEventListener('click',event=>{
        event.preventDefault();
        event.stopPropagation();
        deleteNotebookFolder(path);
      });
      summary.append(label,rename,remove);
      summary.onclick=event=>{
        activeNotebookFolder=path;
        el.querySelectorAll('.notebook-folder>summary').forEach(item=>item.classList.remove('selected'));
        summary.classList.add('selected');
        all.classList.remove('selected');
      };
      details.appendChild(summary);
      const inside=document.createElement('div');
      inside.className='notebook-folder-content';
      renderNotes(path,inside);
      appendFolders(path,inside);
      details.appendChild(inside);
      container.appendChild(details);
    }
  };
  if(query) renderNotes('',el);
  else appendFolders('',el);
  if(query&&!matchingNotes.length){
    const empty=document.createElement('div');
    empty.className='text-sm text-slate-400 text-center py-6';
    empty.textContent='No hay notas con esa frase.';
    el.appendChild(empty);
  }else if(!query&&!Object.keys(notes).length&&!folders.length){
    const empty=document.createElement('div');
    empty.className='text-sm text-slate-400 text-center py-6';
    empty.textContent='Sin notas';
    el.appendChild(empty);
  }
  renderNotebookFolderSelect();
}
function renderNotebookFolderSelect(){
  const select=document.getElementById('nbFolderSelect');
  if(!select) return;
  ensureNotebookFolderPaths();
  const folders=sel.profile().notebookFolders||[];
  const current=sel.note()?.folder||'';
  select.innerHTML='<option value="">Sin carpeta</option>'+folders.sort((a,b)=>a.localeCompare(b)).map(path=>
    `<option value="${escAttr(path)}">${'　'.repeat(path.split('/').length-1)}${esc(path.split('/').at(-1))}</option>`).join('');
  select.value=current;
  select.disabled=!sel.note();
}
function openNotebookFolderModal(){
  ensureNotebookFolderPaths();
  const parent=document.getElementById('notebookFolderParent');
  const folders=sel.profile().notebookFolders||[];
  parent.innerHTML='<option value="">Cuaderno (raíz)</option>'+folders.sort((a,b)=>a.localeCompare(b)).map(path=>
    `<option value="${escAttr(path)}">${esc(path.split('/').join(' / '))}</option>`).join('');
  parent.value=activeNotebookFolder||sel.note()?.folder||'';
  document.getElementById('notebookFolderName').value='';
  openModal('notebookFolderModal');
  setTimeout(()=>document.getElementById('notebookFolderName').focus(),40);
}
function closeNotebookFolderModal(){closeModal('notebookFolderModal');}
function saveNotebookFolder(){
  const name=document.getElementById('notebookFolderName').value.trim().replace(/[\\/]/g,' ');
  if(!name) return toast('Escribe un nombre para la carpeta');
  const parent=document.getElementById('notebookFolderParent').value;
  const path=parent?parent+'/'+name:name;
  const folders=sel.profile().notebookFolders;
  if(folders.includes(path)) return toast('Esa carpeta ya existe');
  folders.push(path);
  activeNotebookFolder=path;
  save();renderNoteList();closeNotebookFolderModal();
  toast('Subcarpeta creada');
}
function renameNotebookFolder(oldPath){
  const profile=sel.profile();
  const oldName=oldPath.split('/').at(-1);
  const nextName=prompt('Nuevo nombre de la carpeta:',oldName)?.trim().replace(/[\\/]/g,' ');
  if(!nextName||nextName===oldName) return;
  const parent=oldPath.includes('/')?oldPath.slice(0,oldPath.lastIndexOf('/')):'';
  const nextPath=parent?`${parent}/${nextName}`:nextName;
  if(profile.notebookFolders.includes(nextPath)) return toast('Ya existe una carpeta con ese nombre');
  const replacePath=path=>path===oldPath||path.startsWith(oldPath+'/')
    ?nextPath+path.slice(oldPath.length)
    :path;
  profile.notebookFolders=[...new Set(profile.notebookFolders.map(replacePath))];
  for(const note of Object.values(profile.notes)){
    note.folder=replacePath(note.folder||'');
  }
  activeNotebookFolder=replacePath(activeNotebookFolder);
  save();
  renderNoteList();
  toast('Carpeta renombrada');
}
function deleteNotebookFolder(path){
  const profile=sel.profile();
  if(!profile?.notebookFolders.includes(path)) return;
  const parent=path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';
  openConfirm(`¿Eliminar la carpeta "${path.split('/').at(-1)}" y sus subcarpetas? Las notas se conservarán en ${parent||'la raíz del cuaderno'}.`,()=>{
    const isInside=folder=>folder===path||folder.startsWith(path+'/');
    profile.notebookFolders=profile.notebookFolders.filter(folder=>!isInside(folder));
    for(const note of Object.values(profile.notes)){
      if(isInside(note.folder||'')) note.folder=parent;
    }
    if(isInside(activeNotebookFolder)) activeNotebookFolder=parent;
    save();
    renderNoteList();
    renderAll();
    toast('Carpeta eliminada');
  });
}
function moveActiveNote(folder){
  const note=sel.note();
  if(!note) return;
  note.folder=folder||'';
  activeNotebookFolder=note.folder;
  if(note.folder && !sel.profile().notebookFolders.includes(note.folder)) sel.profile().notebookFolders.push(note.folder);
  save();renderNoteList();
}
function newNotebookEntry(){
  saveCurrentEditors();
  const n=newNote('Nueva nota','');
  n.folder=activeNotebookFolder||'';
  sel.notes()[n.id]=n;
  state.activeNote=n.id;
  save(); renderNoteList(); renderAll();
  openNote(n.id);
}
function openNote(id){
  saveCurrentEditors();
  state.activeNote=id;
  activeNotebookFolder=sel.notes()[id]?.folder||'';
  save(); renderAll();
  // put focus
  setTimeout(()=>document.getElementById('nbTitle').focus(),80);
}
function deleteNote(id){
  openConfirm('¿Eliminar esta nota?',()=>{
    if(state.activeNote===id){ setActiveNote(null); }
    delete sel.notes()[id];
    save(); renderNoteList(); renderAll();
  });
}
function setActiveNote(id){
  saveCurrentEditors();
  state.activeNote=id;
  if(id) activeNotebookFolder=sel.notes()[id]?.folder||'';
  save(); renderAll();
}
function saveNotebook(){
  const n=sel.note();
  if(!n) return;
  n.title=document.getElementById('nbTitle').value.trim()||'Sin título';
  n.content=cleanEditorHTML(document.getElementById('nbEditor').innerHTML);
  save(); renderNoteList();
}
document.getElementById('nbTitle').addEventListener('input', saveNotebook);
const editorMatchTimers=new WeakMap();
for(const [editor,type,getId] of [
  [document.getElementById('songEditor'),'song',()=>state.activeSong],
  [document.getElementById('nbEditor'),'note',()=>state.activeNote]
]){
  editor.addEventListener('beforeinput',event=>moveCaretOutOfHighlight(editor,event));
  editor.addEventListener('input',event=>{
    const closesPanel=event.inputType?.startsWith('delete')||
      ['insertLineBreak','insertParagraph'].includes(event.inputType)||
      event.inputType?.startsWith('insertFromPaste')||
      (typeof event.data==='string'&&/\s/u.test(event.data));
    if(closesPanel) hideLiveMatchPanel();
    saveCurrentEditors();
    save();
    if(!event.isComposing){
      clearTimeout(editorMatchTimers.get(editor));
      editorMatchTimers.set(editor,setTimeout(
        ()=>applySmartMatches(editor,type,getId(),true,!closesPanel),360
      ));
    }
  });
}
function refreshSmartMatchesAfterBlur(editor,type,getId){
  setTimeout(()=>{
    const modalOpen=[...document.querySelectorAll('.fixed.inset-0')].some(modal=>!modal.classList.contains('hidden'));
    if(document.getElementById('hlMenu').classList.contains('hidden')&&!modalOpen) applySmartMatches(editor,type,getId());
  },0);
}
document.getElementById('nbEditor').addEventListener('blur',()=>refreshSmartMatchesAfterBlur(document.getElementById('nbEditor'),'note',()=>state.activeNote));
document.getElementById('songEditor').addEventListener('blur',()=>refreshSmartMatchesAfterBlur(document.getElementById('songEditor'),'song',()=>state.activeSong));

/* ---------- Tab handling ---------- */
function renderAll(){
  if(!state.activeProfile) return;
  syncSidebar();
  renderDictList();
  renderWords();
  renderSongList();
  renderNoteList();
  bindHighlightClicks();
  // load editors
  loadSongEditor();
  loadNoteEditor();
  const activeTab=document.querySelector('.tab-btn.active')?.dataset.tab;
  if(activeTab==='songs') applySmartMatches(document.getElementById('songEditor'),'song',state.activeSong);
  if(activeTab==='notebook') applySmartMatches(document.getElementById('nbEditor'),'note',state.activeNote);
  const songWrap=document.getElementById('songEditorWrap'), songEmpty=document.getElementById('songEditorEmpty');
  const nbWrap=document.getElementById('nbWrap'), nbEmpty=document.getElementById('nbEmpty');
  const s=sel.song(), n=sel.note();
  if(s){ songWrap.classList.remove('hidden'); songEmpty.classList.add('hidden'); }
  else { songWrap.classList.add('hidden'); songEmpty.classList.remove('hidden'); }
  if(n){ nbWrap.classList.remove('hidden'); nbEmpty.classList.add('hidden'); }
  else { nbWrap.classList.add('hidden'); nbEmpty.classList.remove('hidden'); }
  // active dict data
}
let loadedSongEditorId=null;
let loadedNoteEditorId=null;
function loadSongEditor(){
  const s=sel.song();
  document.getElementById('songEditorTitle').textContent = s? s.title:'';
  document.getElementById('songEditorArtist').textContent = s? s.artist:'';
  const el = document.getElementById('songEditor');
  const id=s?.id||null;
  if(id!==loadedSongEditorId || !s || document.activeElement!==el){
    el.innerHTML = songLyricsHTML(s?.lyrics||'');
      loadedSongEditorId=id;
    if(s){ bindHighlightClicks(); renderHighlightSpans({el,key:'song'}); }
  }
}
function loadNoteEditor(){
  const n=sel.note();
  const t=document.getElementById('nbTitle');
  const id=n?.id||null;
  if(n && (id!==loadedNoteEditorId || document.activeElement!==t)) t.value = n.title;
  const el=document.getElementById('nbEditor');
  if(id!==loadedNoteEditorId || !n || document.activeElement!==el){
    el.innerHTML=cleanEditorHTML(n?.content||'');
    loadedNoteEditorId=id;
    if(n){ bindHighlightClicks(); renderHighlightSpans({el,key:'note'}); }
  }
}

/* ---------- Excel import / export ---------- */
function esc(v){ return String(v===undefined?'':v).replace(/[&<>\"]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function escAttr(v){ return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
async function exportExcel(){
  if(!state.activeProfile) return toast('Selecciona un perfil');
  if(!window.XLSX) return toast('No se pudo cargar el exportador Excel');
  const profile=sel.profile();
  const data=tableRows(profile);
  const columns={
    diccionario:['id','perfil','idioma','carpeta','palabra','traduccion','pronunciacion','multimedia','tracker','enlaces'],
    canciones:['id','perfil','artista','titulo','letra','tracker','metadatos'],
    cuaderno:['id','perfil','titulo','contenido','metadatos']
  };
  const workbook=XLSX.utils.book_new();
  for(const [sheet,headers] of Object.entries(columns)){
    const rows=[headers,...data[sheet].map(row=>headers.map(header=>row[header]??''))];
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),sheet);
  }
  XLSX.writeFile(workbook,`language_lab_${slugify(profile.name)}.xlsx`,{compression:true});
  toast('Archivo Excel descargado');
}
function normalizeExcelHeader(value){
  return String(value||'').replace(/^\ufeff/,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
}
function handleImport(input){
  const file=input.files?.[0];
  input.value='';
  if(!file) return;
  const settings=document.getElementById('settingsModal');
  if(settings && !settings.classList.contains('hidden')) closeSettings();
  const sidebar=document.getElementById('mobileSidebar');
  if(sidebar && !sidebar.classList.contains('-translate-x-full')) toggleMobileSidebar();
  dropMenu.hide();
  void importExcelFile(file);
}
function readFileAsArrayBuffer(file){
  if(typeof file.arrayBuffer==='function') return file.arrayBuffer();
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error||new Error('No se pudo leer el archivo'));
    reader.readAsArrayBuffer(file);
  });
}
async function importExcelFile(file){
  if(!window.XLSX) return toast('No se pudo cargar el lector Excel');
  const profile=sel.profile();
  if(!profile) return toast('Selecciona un perfil antes de importar');
  try{
    const buffer=await readFileAsArrayBuffer(file);
    const signature=new Uint8Array(buffer.slice(0,8));
    const xlsxZip=signature[0]===0x50&&signature[1]===0x4b;
    const legacyXls=signature[0]===0xd0&&signature[1]===0xcf&&signature[2]===0x11&&signature[3]===0xe0;
    if(!xlsxZip&&!legacyXls) return toast('El archivo no parece ser un Excel (.xlsx o .xls)');
    const workbook=XLSX.read(buffer,{type:'array'});
    const sheets={diccionario:[],canciones:[],cuaderno:[]};
    const aliases={cuadernos:'cuaderno'};
    for(const name of workbook.SheetNames){
      const normalizedName=normalizeExcelHeader(name);
      const sheet=aliases[normalizedName]||normalizedName;
      if(!Object.prototype.hasOwnProperty.call(sheets,sheet)) continue;
      const rows=XLSX.utils.sheet_to_json(workbook.Sheets[name],{defval:'',raw:false,blankrows:false});
      sheets[sheet]=rows.map(row=>{
        const normalized={};
        for(const [key,value] of Object.entries(row)) normalized[normalizeExcelHeader(key)]=value;
        return normalized;
      }).filter(row=>Object.values(row).some(value=>String(value??'').trim()));
    }
    const rowCount=Object.values(sheets).reduce((sum,rows)=>sum+rows.length,0);
    if(!rowCount) return toast('El Excel no contiene hojas o filas compatibles');
    applyExcelRows(profile,sheets);
    invalidateDictionaryPhraseIndex();
    if(!state.activeDict) state.activeDict=Object.keys(profile.dictionaries)[0]||null;
    save();
    renderAll();
    toast('Excel importado en este dispositivo');
  }catch(error){
    console.error('No se pudo importar el archivo Excel:',error);
    toast('No se pudo leer el Excel');
  }
}
function slugify(s){ return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||'perfil'; }


/* ---------- Backup / restore (base de datos completa) ---------- */
function exportAppBackup(){
  if(!state.activeProfile) return toast('Selecciona un perfil');
  const payload={
    app:'Language Lab',
    exportedAt:new Date().toISOString(),
    state:state,
    local:{
      [LS_KEY]:storageGet(LS_KEY),
      perfil_activo:storageGet('perfil_activo'),
      perfil_activo_id:storageGet('perfil_activo_id'),
      [DARK_KEY]:storageGet(DARK_KEY),
      [ACTIVE_TAB_KEY]:storageGet(ACTIVE_TAB_KEY),
      [DESKTOP_SIDEBAR_KEY]:storageGet(DESKTOP_SIDEBAR_KEY)
    }
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=`language_lab_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('Respaldo descargado');
}
async function handleBackupImport(input){
  const file=input.files?.[0];
  input.value='';
  if(!file) return;
  const settings=document.getElementById('settingsModal');
  if(settings && !settings.classList.contains('hidden')) closeSettings();
  const sidebar=document.getElementById('mobileSidebar');
  if(sidebar && !sidebar.classList.contains('-translate-x-full')) toggleMobileSidebar();
  dropMenu.hide();
  let payload;
  try{
    payload=JSON.parse(await file.text());
  }catch(error){
    return toast('No se pudo leer el archivo JSON');
  }
  const data=payload?.state||payload;
  if(!data||typeof data!=='object'||!data.profiles) return toast('El archivo no es un respaldo válido de Language Lab');
  openConfirm('¿Restaurar este respaldo? Se reemplazarán todos los datos de este dispositivo.',()=>{
    state=data;
    Object.values(state.profiles).forEach(normalizeProfile);
    if(!state.profiles[state.activeProfile]) state.activeProfile=null;
    if(state.activeProfile===ADMIN_PROFILE_ID) state.activeProfile=null;
    state.activeDict=null; state.activeSong=null; state.activeNote=null;
    invalidateDictionaryPhraseIndex();
    save({immediate:true});
    toast('Respaldo restaurado; recargando…');
    setTimeout(()=>location.reload(),600);
  });
}

/* ---------- misc UI ---------- */
function toggleMobileSidebar(){
  const sb=document.getElementById('mobileSidebar');
  const ov=document.getElementById('mobileOverlay');
  const open=sb.classList.contains('-translate-x-full');
  sb.classList.toggle('-translate-x-full', !open);
  ov.classList.toggle('hidden', !open);
  renderDictList();
}
const DESKTOP_SIDEBAR_KEY='language_lab_sidebar_collapsed';
function toggleDesktopSidebar(force){
  const app=document.getElementById('app');
  const collapsed=typeof force==='boolean'?force:!app.classList.contains('sidebar-collapsed');
  app.classList.toggle('sidebar-collapsed',collapsed);
  const button=document.getElementById('desktopSidebarToggle');
  button.setAttribute('aria-expanded',String(!collapsed));
  button.setAttribute('aria-label',collapsed?'Mostrar menú lateral':'Ocultar menú lateral');
  button.title=collapsed?'Mostrar menú lateral':'Ocultar menú lateral';
  button.textContent=collapsed?'▶':'◀';
  storageSet(DESKTOP_SIDEBAR_KEY,collapsed?'1':'0');
}
function switchTab(tab){
  if(!VALID_TABS.includes(tab)) return;
  hideLinkQuickButton();
  closeHighlightSidebar();
  document.getElementById('hlMenu').classList.add('hidden');
  document.getElementById('smartPopover').classList.add('hidden');
  VALID_TABS.forEach(t=>{
    document.getElementById('tab-'+t).classList.toggle('hidden', t!==tab);
  });
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.getElementById('tab-'+tab).classList.add('fade');
  storageSet(ACTIVE_TAB_KEY,tab);
  requestAnimationFrame(()=>{
    if(tab==='songs') applySmartMatches(document.getElementById('songEditor'),'song',state.activeSong);
    if(tab==='notebook') applySmartMatches(document.getElementById('nbEditor'),'note',state.activeNote);
  });
}
document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>{ saveCurrentEditors(); switchTab(b.dataset.tab); }));
let swipeStart=null;
document.querySelector('main').addEventListener('touchstart',e=>{
  const touch=e.changedTouches[0];
  swipeStart={x:touch.clientX,y:touch.clientY};
},{passive:true});
document.querySelector('main').addEventListener('touchend',e=>{
  if(!swipeStart) return;
  const touch=e.changedTouches[0],dx=touch.clientX-swipeStart.x,dy=touch.clientY-swipeStart.y;
  swipeStart=null;
  if(Math.abs(dx)<70 || Math.abs(dx)<Math.abs(dy)*1.25) return;
  const current=document.querySelector('.tab-btn.active')?.dataset.tab;
  const tabs=VALID_TABS;
  const index=tabs.indexOf(current);
  const next=tabs[Math.max(0,Math.min(tabs.length-1,index+(dx<0?1:-1)))];
  if(next!==current){ saveCurrentEditors(); switchTab(next); }
},{passive:true});

function persistActiveWork(){
  saveCurrentEditors();
  save({immediate:true});
}
window.addEventListener('pagehide',persistActiveWork);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden') persistActiveWork();
});
window.addEventListener('beforeunload',persistActiveWork);
document.addEventListener('keydown',(e)=>{
  if(e.key==='Escape'){
    const visible=[...document.querySelectorAll('#wordModal,#folderModal,#notebookFolderModal,#dictModal,#copyModal,#songModal,#linkModal,#settingsModal,#noteModal,#editHighlightModal,#confirmModal')]
      .filter(modal=>!modal.classList.contains('hidden'));
    if(visible.length){
      const top=visible[visible.length-1].id;
      if(top==='confirmModal') closeConfirm(); else closeModal(top);
    }
    else document.getElementById('hlMenu').classList.add('hidden');
    dropMenu.hide();
    return;
  }
  if(e.key==='Enter'){
    const modal=[...document.querySelectorAll('#wordModal,#folderModal,#notebookFolderModal,#dictModal,#copyModal,#songModal,#settingsModal,#noteModal,#editHighlightModal,#confirmModal')]
      .filter(item=>!item.classList.contains('hidden')).pop();
    if(!modal || (e.target.tagName==='TEXTAREA' && e.shiftKey)) return;
    e.preventDefault();
    const actions={
      wordModal:saveWord,folderModal:saveFolder,notebookFolderModal:saveNotebookFolder,dictModal:saveDict,copyModal:doCopy,
      songModal:saveSong,noteModal:saveHighlightNote,
      editHighlightModal:saveHighlightText,confirmModal:runConfirmAction
    };
    actions[modal.id]?.();
  }
});

/* folder modal (kept for addFolderPrompt replacement) */
function addFolderModal(){ openModal('folderModal'); }
function closeFolderModal(){ closeModal('folderModal'); }
function saveFolder(){
  const name=document.getElementById('folderName').value.trim();
  const d=sel.dict();
  if(!name||!d) return toast('Nombre inválido');
  if(!d.folders.includes(name)) d.folders.push(name);
  save(); renderAll(); closeModal('folderModal');
  toast('Carpeta creada');
}

/* ---------- Dark mode ---------- */
const DARK_KEY='lanlearn_dark';
function applyDark(dark){
  document.documentElement.classList.toggle('dark', dark);
  const icon = dark?'☀️':'🌙';
  ['darkToggleHome','darkToggleSide','darkToggleMob'].forEach(id=>{ const b=document.getElementById(id); if(b) b.textContent=icon; });
}
function toggleDark(){
  const dark = !document.documentElement.classList.contains('dark');
  applyDark(dark);
  storageSet(DARK_KEY,dark?'1':'0');
}
function bootDark(){
  let dark=false;
  const savedTheme=storageGet(DARK_KEY);
  dark=savedTheme==='1';
  if(dark || (typeof window.matchMedia==='function' && window.matchMedia('(prefers-color-scheme: dark)').matches && savedTheme===null)){
    applyDark(true);
  } else {
    applyDark(false);
  }
}

/* ---------- Service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const appBase = new URL('.', window.location.href);
    navigator.serviceWorker.register(new URL('sw.js', appBase)).catch(error => {
      console.error('No se pudo registrar el modo sin conexión:', error);
    });
  });
}

/* boot */
Object.assign(window,{
  addDictModal,addFolderModal,applyLink,closeConfirm,closeCopyModal,closeDictModal,
  closeEditHighlight,closeFolderModal,closeLinkModal,closeNoteModal,closeSettings,closeNotebookFolderModal,
  closeSongModal,closeWordModal,copyDictTo,copyWord,createProfile,deleteActiveProfile,
  deleteDictionary,deleteNote,deleteSelected,deleteWord,doCopy,editDictMenu,editWord,exportExcel,
  handleImport,hlAddNote,hlEditPhrase,hlLink,hlOpenLink,hlRemove,shareSelectedWords,shareFilteredFolder,
  copyFloatingSelection,cutFloatingSelection,deleteFloatingSelection,
  hlEditNote,hlSendToDict,hlSetColor,hlSetSize,newNotebookEntry,openNote,openSettings,
  navigateToSource,openSong,openSongModal,openWordModal,removeLink,renderLinkResults,renderSongList,renderWords,
  runConfirmAction,saveDict,saveFolder,saveHighlightNote,saveHighlightText,
  saveSong,saveWord,selectProfile,setActiveDict,setActiveNote,setActiveSong,showLinkedWord,
  songMenu,studyToday,switchTab,toggleDark,toggleMobileSidebar,toggleProfiles,toggleSongStudy,
  deleteProfilePrompt,enterApp,linkCancel,closeModal,dropMenu,openNotebookFolderModal,exportAppBackup,handleBackupImport,
  saveNotebookFolder,deleteNotebookFolder,moveActiveNote,moveOnboarding,skipOnboarding,
});
Object.assign(window,{
  storageGet,storageSet,storageRemove,toast,defaultState,normalizeProfile,load,save,
  jsonField,linkedSources,tableRows,applyExcelRows,agregarPalabra,newDict,newProfile,
  newWord,newSong,songLyricsHTML,newNote,todayStr,
  onboardingSteps,startOnboarding,renderOnboardingStep,finishOnboarding,
  boot,renderProfiles,syncSidebar,renderStudySummary,renderDictList,openDictModal,
  openModal,openConfirm,renameDictionaryFolder,deleteDictionaryFolder,getStreak,currentSelectionIds,
  updateCopyCount,renderCopyModal,renderWordFolders,renderMediaPreview,saveCurrentEditors,
  currentEditor,buildColorBars,highlightSelection,renderHighlightSpans,normalizePhrase,
  cleanEditorHTML,sourceText,sourceLabel,phraseOccurs,crossSourcesForPhrase,phrasesForIndex,
  captureEditorCaret,moveCaretOutOfHighlight,restoreEditorCaret,applySmartMatches,
  showSmartPopover,navigateToSmartSource,retainAutoMatch,promoteAutoMatch,openLiveMatchMenu,
  ensureHlTarget,closeHighlightSidebar,showHighlightSidebar,saveSidebarHighlightNote,
  showHlMenu,shareFloatingSelection,bindHighlightClicks,noteModal,linkInfo,saveCurrentEditorsFromSpan,
  ensureNotebookFolderPaths,renderNoteList,renderNotebookFolderSelect,renameNotebookFolder,deleteNotebookFolder,
  saveNotebook,refreshSmartMatchesAfterBlur,renderAll,loadSongEditor,loadNoteEditor,
  esc,escAttr,normalizeExcelHeader,readFileAsArrayBuffer,importExcelFile,slugify,
  toggleDesktopSidebar,applyDark,bootDark,resizeSongLyricsInput
});
function bindStaticMarkupActions(){
  document.querySelectorAll('[data-click-action]').forEach(element=>{
    element.addEventListener('click',()=>{
      const action=element.dataset.clickAction;
      if(action==='toggleDropMenu'){
        dropMenu.toggle();
        return;
      }
      const callback=window[action];
      if(typeof callback!=='function') return;
      let args=[];
      try{ args=JSON.parse(element.dataset.actionArgs||'[]'); }catch(error){}
      callback(...args);
    });
  });
  document.querySelectorAll('[data-dismiss-action]').forEach(element=>{
    element.addEventListener('click',event=>{
      if(event.target!==element) return;
      const callback=window[element.dataset.dismissAction];
      if(typeof callback==='function') callback();
    });
  });
  for(const [selector,eventName] of [
    ['[data-input-action]','input'],
    ['[data-change-action]','change']
  ]){
    document.querySelectorAll(selector).forEach(element=>{
      element.addEventListener(eventName,()=>{
        const callback=window[element.dataset[eventName==='input'?'inputAction':'changeAction']];
        if(typeof callback!=='function') return;
        const parameter=element.dataset.actionParam;
        if(parameter==='element') callback(element);
        else if(parameter==='value') callback(element.value);
        else {
          let args=[];
          try{ args=JSON.parse(element.dataset.actionArgs||'[]'); }catch(error){}
          callback(...args);
        }
      });
    });
  }
  document.querySelectorAll('[data-keyboard-activate]').forEach(element=>{
    element.addEventListener('keydown',event=>{
      if(event.key!=='Enter'&&event.key!==' ') return;
      event.preventDefault();
      element.click();
    });
  });
}
bindStaticMarkupActions();
toggleDesktopSidebar(storageGet(DESKTOP_SIDEBAR_KEY,'0')==='1');
buildColorBars();
bootDark();
boot();
