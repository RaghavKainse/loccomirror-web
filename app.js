/**
 * loccoMirror - Desktop Frontend Controller for WebView2
 * Handles page switching, responsive controls, hotkey recording, 
 * settings persistence, and C++ Host Bridge integration.
 */

// ==========================================================================
// 1. C++ Host Bridge (WebView2 Integration)
// ==========================================================================
window.LoccoHost = {
  send: function (action, payload = {}) {
    const message = { action, payload, timestamp: Date.now() };
    console.log('[WebView2 Bridge -> Host]:', message);

    // Windows WebView2 Host Interop
    if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === 'function') {
      window.chrome.webview.postMessage(message);
    }
  },
  onMessage: function (callback) {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.addEventListener('message', function (e) {
        console.log('[Host -> WebView2 Bridge]:', e.data);
        if (typeof callback === 'function') callback(e.data);
      });
    }
  }
};

// Module-level HTML escaping helper
function escHtml(str) {
  if (str === null || str === undefined) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

// ==========================================================================
// 2. Default Configuration State
// ==========================================================================
const DEFAULT_CONFIG = {
  theme: 'dark',
  video: {
    resolution: '1080p',
    fps: 60,
    bitrate: 8,
    decoder: 'd3d11va',
    codec: 'h264',
    lowLatency: true,
    vsync: false
  },
  general: {
    language: 'en',
    startup: false,
    tray: true,
    closeToTray: true,
    alwaysOnTop: false,
    connNotify: true,
    recNotify: true,
    logLevel: 'info'
  },
  recording: {
    outputPath: 'Videos\\loccoMirror_Recordings',
    format: 'mp4',
    quality: 'original',
    audioSource: 'both',
    audioBitrate: '192',
    autoSplit: false,
    splitSize: '4096',
    watermark: false
  },
  shortcuts: {
    toggle_mirror: ['Ctrl', 'M'],
    screenshot: ['Ctrl', 'Shift', 'S'],
    toggle_recording: ['Ctrl', 'R'],
    toggle_fullscreen: ['F11'],
    screen_off: ['Ctrl', 'O'],
    volume_up: ['Ctrl', '↑'],
    volume_down: ['Ctrl', '↓']
  },
};

// State Object loaded from Storage or Defaults
let AppState = loadStoredConfig();

function loadStoredConfig() {
  try {
    const saved = localStorage.getItem('locco_mirror_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.video) {
        if (!parsed.video.resolution || parsed.video.resolution === '1080p' || parsed.video.resolution === '4k') {
          parsed.video.resolution = 'native';
          parsed.video.bitrate = 65;
        }
      }
      return Object.assign({}, DEFAULT_CONFIG, parsed);
    }
  } catch (e) {
    console.warn('Failed to load local config, using defaults:', e);
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function persistConfig() {
  try {
    localStorage.setItem('locco_mirror_settings', JSON.stringify(AppState));
    LoccoHost.send('save_settings', AppState);
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// ==========================================================================
// 3. Navigation & Page Switching
// ==========================================================================
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  const panels = document.querySelectorAll('.page-panel');

  function switchPage(pageId) {
    // Update nav buttons
    navButtons.forEach(btn => {
      if (btn.dataset.page === pageId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update view panels
    panels.forEach(panel => {
      if (panel.id === `page-${pageId}`) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });

    // Update URL Hash
    window.location.hash = pageId;
    LoccoHost.send('tab_changed', { tab: pageId });
  }

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const pageId = btn.dataset.page;
      switchPage(pageId);
    });
  });

  // Handle Hash routing on load
  const currentHash = window.location.hash.replace('#', '');
  if (currentHash && document.getElementById(`page-${currentHash}`)) {
    switchPage(currentHash);
  } else {
    switchPage('video');
  }

  // Handle back/forward navigation
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash && document.getElementById(`page-${hash}`)) {
      switchPage(hash);
    }
  });
}

// ==========================================================================
// 4. UI Interactive Controls Binding & IPC Triggers
// ==========================================================================
function bindInteractiveControls() {
  // Theme Switching
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeRadios = document.querySelectorAll('input[name="appTheme"]');

  function applyTheme(theme) {
    AppState.theme = theme;
    if (theme === 'system') {
      const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isSystemDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }

    // Update radio buttons
    themeRadios.forEach(r => {
      const card = r.closest('.theme-radio-card');
      if (r.value === theme) {
        r.checked = true;
        if (card) card.classList.add('active');
      } else {
        if (card) card.classList.remove('active');
      }
    });

    LoccoHost.send('set_theme', { theme });
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      showToast(`Switched to ${next === 'dark' ? 'Dark Obsidian' : 'Light Clean'} mode`);
    });
  }

  themeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      applyTheme(radio.value);
    });
  });

  // Window Titlebar Drag & Window Controls
  const dragRegion = document.querySelector('.window-drag-region');
  if (dragRegion) {
    dragRegion.addEventListener('mousedown', (e) => {
      // If clicking directly on text or background (not interactive buttons/badges)
      if (e.target.closest('button') || e.target.closest('input')) return;
      LoccoHost.send('window_drag', {});
    });
  }

  let isMirrorActive = false;

  function setMirrorButtonState(active) {
    isMirrorActive = active;
    const btn = document.getElementById('btnToggleMirror');
    const icon = document.getElementById('btnToggleMirrorIcon');
    const text = document.getElementById('btnToggleMirrorText');
    if (!btn || !icon || !text) return;

    btn.disabled = false;
    icon.classList.remove('spin-animation');

    if (active) {
      icon.className = 'ri-stop-circle-line';
      text.textContent = 'Stop Mirroring';
      btn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
      btn.style.boxShadow = '0 2px 8px rgba(239,68,68,0.35)';
    } else {
      icon.className = 'ri-play-circle-line';
      text.textContent = 'Start Mirroring (with USB Debugging)';
      btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      btn.style.boxShadow = '0 2px 8px rgba(16,185,129,0.35)';
    }
  }

  // Listen to C++ Host status updates
  LoccoHost.onMessage((data) => {
    if (!data) return;
    if (data.type === 'mirror_state') {
      setMirrorButtonState(!!data.active);
    } else if (data.type === 'mirror_btn_state') {
      const btn = document.getElementById('btnToggleMirror');
      const icon = document.getElementById('btnToggleMirrorIcon');
      const text = document.getElementById('btnToggleMirrorText');
      if (btn && icon && text) {
        icon.className = 'ri-loader-4-line spin-animation';
        text.textContent = data.text || 'Processing...';
        btn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
        btn.style.boxShadow = '0 2px 8px rgba(245,158,11,0.35)';
      }
    } else if (data.type === 'toast') {
      showToast(data.message || '', data.toastType || 'info');
    } else if (data.type === 'gpu_info') {
      updateGpuDecoderUI(data);
    }
  });

  // Start Mirroring with USB Debugging (Top Nav)
  document.getElementById('btnToggleMirror')?.addEventListener('click', () => {
    if (!isMirrorActive) {
      const btn = document.getElementById('btnToggleMirror');
      const icon = document.getElementById('btnToggleMirrorIcon');
      const text = document.getElementById('btnToggleMirrorText');
      if (btn && icon && text) {
        icon.className = 'ri-loader-4-line spin-animation';
        text.textContent = 'Connecting...';
        btn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
        btn.style.boxShadow = '0 2px 8px rgba(245,158,11,0.35)';
      }
      showToast('Connecting via USB Debugging (ADB)...', 'info');
    }
    LoccoHost.send('toggle_mirror', {});
  });

  // Start Mirroring without USB Debugging (Top Nav AOA Direct)
  document.getElementById('btnConnectAoaTop')?.addEventListener('click', () => {
    LoccoHost.send('connect_aoa', {});
    showToast('⚡ Connecting via AOA Direct (without USB Debugging, <5ms latency)...', 'info');
  });

  document.getElementById('winMinimize')?.addEventListener('click', () => {
    LoccoHost.send('window_minimize', {});
  });

  document.getElementById('winMaximize')?.addEventListener('click', () => {
    LoccoHost.send('window_maximize', {});
  });

  document.getElementById('winClose')?.addEventListener('click', () => {
    LoccoHost.send('window_close', {});
  });

  const RESOLUTION_PRESETS = {
    'eco': { width: 1280, height: 720, defaultBitrate: 5, label: '⚡ Eco Cool (720p - Zero Heat)' },
    '720p': { width: 1280, height: 720, defaultBitrate: 6, label: '720p HD (Low Heat)' },
    '1080p': { width: 1920, height: 1080, defaultBitrate: 8, label: '1080p FHD (Optimal / Cool)' },
    'native': { width: 0, height: 0, defaultBitrate: 10, label: 'Native (Original 1:1)' },
    '1440p': { width: 2560, height: 1440, defaultBitrate: 14, label: '2K QHD' },
    '2k': { width: 2560, height: 1440, defaultBitrate: 14, label: '2K QHD' },
    '4k': { width: 3840, height: 2160, defaultBitrate: 18, label: '4K UHD' }
  };

  function getBitrateSuffix(val) {
    if (val <= 6) return ' (Eco Cool - Zero Heat)';
    if (val <= 10) return ' (Optimal - Low Temp)';
    if (val <= 16) return ' (High Quality)';
    return ' (Max)';
  }

  function getResolutionDimensions(resKey) {
    const preset = RESOLUTION_PRESETS[resKey];
    if (preset) return { width: preset.width, height: preset.height };
    return { width: 0, height: 0 };
  }

  // Restore Defaults Sidebar Button
  document.getElementById('btnRestoreDefaults')?.addEventListener('click', () => {
    AppState = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    syncUIFromState();
    persistConfig();
    const dim = getResolutionDimensions(AppState.video.resolution);
    LoccoHost.send('set_video_config', {
      resolution: AppState.video.resolution,
      width: dim.width,
      height: dim.height,
      fps: AppState.video.fps || 60,
      bitrate: (AppState.video.bitrate || 50) * 1000000
    });
    LoccoHost.send('set_resolution', { resolution: AppState.video.resolution });
    showToast('All system & video settings restored to factory defaults!');
  });

  // Video Settings: Resolution Segmented Control
  const resButtons = document.querySelectorAll('#videoResolutionControl .segment-btn');
  resButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      resButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const resKey = btn.dataset.value;
      AppState.video.resolution = resKey;

      const preset = RESOLUTION_PRESETS[resKey] || RESOLUTION_PRESETS['1080p'];
      AppState.video.bitrate = preset.defaultBitrate;

      const slider = document.getElementById('videoBitrateSlider');
      const badge = document.getElementById('videoBitrateBadge');
      if (slider && badge) {
        slider.value = preset.defaultBitrate;
        badge.textContent = `${preset.defaultBitrate} Mbps${getBitrateSuffix(preset.defaultBitrate)}`;
      }

      LoccoHost.send('set_video_config', {
        resolution: resKey,
        width: preset.width,
        height: preset.height,
        fps: AppState.video.fps || 60,
        bitrate: preset.defaultBitrate * 1000000
      });
      LoccoHost.send('set_resolution', { resolution: resKey });
      persistConfig();
      showToast(`Resolution switched to ${preset.label} (${preset.defaultBitrate} Mbps)`);
    });
  });

  // Video Settings: FPS Pill Group
  const fpsButtons = document.querySelectorAll('#videoFpsGroup .pill-btn');
  fpsButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      fpsButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.video.fps = parseInt(btn.dataset.fps, 10);
      const dim = getResolutionDimensions(AppState.video.resolution);
      LoccoHost.send('set_video_config', {
        resolution: AppState.video.resolution || '4k',
        width: dim.width,
        height: dim.height,
        fps: AppState.video.fps,
        bitrate: (AppState.video.bitrate || 50) * 1000000
      });
      persistConfig();
      showToast(`Target Framerate: ${AppState.video.fps} FPS`);
    });
  });

  // Video Settings: Bitrate Range Slider
  const bitrateSlider = document.getElementById('videoBitrateSlider');
  const bitrateBadge = document.getElementById('videoBitrateBadge');
  if (bitrateSlider && bitrateBadge) {
    bitrateSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      bitrateBadge.textContent = `${val} Mbps${getBitrateSuffix(val)}`;
      AppState.video.bitrate = val;
      LoccoHost.send('set_bitrate_only', {
        bitrate: val * 1000000
      });
    });
    bitrateSlider.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      persistConfig();
      showToast(`Video Bitrate tuned: ${val} Mbps`);
    });
  }

  // Hardware Video Decoder Selection
  document.getElementById('videoDecoderSelect')?.addEventListener('change', (e) => {
    const chosen = e.target.value;
    AppState.video.decoder = chosen;
    LoccoHost.send('set_decoder', { decoder: chosen });
    persistConfig();

    const isSw = (chosen === 'software');
    const selectedText = e.target.options[e.target.selectedIndex]?.text || '';
    const nameLabel = isSw ? 'CPU Software Decoding' : selectedText.split('(')[0].trim();
    showToast(`Switched to: ${nameLabel}`, 'success');

    if (gLastGpuInfo) {
      const chosenIdx = chosen.startsWith('gpu_') ? parseInt(chosen.replace('gpu_', ''), 10) : gLastGpuInfo.activeGpuIndex;
      updateGpuDecoderUI(Object.assign({}, gLastGpuInfo, {
        activeDecoder: isSw ? 'software' : 'd3d11va',
        activeGpuIndex: chosenIdx
      }));
    }
  });

  // Folder Browse & Diagnostics
  document.getElementById('btnBrowseFolder')?.addEventListener('click', () => {
    LoccoHost.send('browse_recording_folder', {});
    showToast('Invoking Windows Folder Browser...');
  });

  document.getElementById('btnOpenRecFolder')?.addEventListener('click', () => {
    LoccoHost.send('open_folder', { path: AppState.recording.outputPath });
    showToast('Opening Recordings folder in Windows Explorer');
  });

  document.getElementById('btnOpenLogs')?.addEventListener('click', () => {
    LoccoHost.send('open_logs_folder', {});
    showToast('Opening diagnostic log folder');
  });

  document.getElementById('btnRestartAdb')?.addEventListener('click', () => {
    LoccoHost.send('restart_adb', {});
    showToast('Restarting ADB Server daemon...');
  });

  document.getElementById('btnInstallPhoneApk')?.addEventListener('click', () => {
    LoccoHost.send('install_apk_phone', {});
    showToast('Installing loccoMirror companion app on phone...', 'info');
  });

  document.getElementById('btnSwitchDevice')?.addEventListener('click', () => {
    LoccoHost.send('show_device_picker', {});
    showToast('Scanning connected ADB & AOA devices...');
  });

  document.getElementById('btnConnectAoa')?.addEventListener('click', () => {
    LoccoHost.send('connect_aoa', {});
    showToast('⚡ Initiating AOA Direct USB Handshake (bypassing ADB, &lt;5ms latency)...', 'info');
  });

  // Global "Restore Defaults" button in Sidebar
  document.getElementById('btnRestoreDefaults')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to restore all settings to default values?')) {
      AppState = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      persistConfig();
      syncUIFromState();
      showToast('All settings restored to factory defaults!');
    }
  });

  document.getElementById('btnCheckUpdates')?.addEventListener('click', () => {
    LoccoHost.send('check_updates', {});
    showToast('Checking for latest updates...', 'info');
  });

  document.getElementById('btnResetShortcuts')?.addEventListener('click', () => {
    AppState.shortcuts = JSON.parse(JSON.stringify(DEFAULT_CONFIG.shortcuts));
    renderShortcutsTable();
    showToast('Shortcuts reset to defaults.');
  });
}

// ==========================================================================
// 5. Hotkey Recorder for Shortcuts Settings Page
// ==========================================================================
let activeRecordingRow = null;
let recordingHandler = null;

window.startRecordingKey = function (element, actionKey) {
  // If already recording this one, cancel
  if (activeRecordingRow === element) {
    stopRecordingKey();
    return;
  }

  stopRecordingKey(); // stop any other recording

  activeRecordingRow = element;
  element.classList.add('recording');
  element.innerHTML = `<span style="font-family:var(--font-mono);font-size:12px;color:var(--accent-primary);font-weight:700;">Press Key Combination... (Esc to cancel)</span>`;

  recordingHandler = function (e) {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      stopRecordingKey();
      renderShortcutsTable();
      return;
    }

    const keys = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (e.metaKey) keys.push('Win');

    let keyName = e.key;
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(keyName)) {
      return;
    }

    if (keyName === 'ArrowUp') keyName = '↑';
    else if (keyName === 'ArrowDown') keyName = '↓';
    else if (keyName === 'ArrowLeft') keyName = '←';
    else if (keyName === 'ArrowRight') keyName = '→';
    else if (keyName.length === 1) keyName = keyName.toUpperCase();

    keys.push(keyName);

    AppState.shortcuts[actionKey] = keys;
    stopRecordingKey();
    renderShortcutsTable();
    showToast(`Keybinding for ${actionKey} updated to ${keys.join(' + ')}`);
    persistConfig();
  };

  window.addEventListener('keydown', recordingHandler, true);
};

function stopRecordingKey() {
  if (recordingHandler) {
    window.removeEventListener('keydown', recordingHandler, true);
    recordingHandler = null;
  }
  if (activeRecordingRow) {
    activeRecordingRow.classList.remove('recording');
    activeRecordingRow = null;
  }
}

function renderShortcutsTable() {
  const tbody = document.getElementById('shortcutsTableBody');
  if (!tbody) return;

  const actionsMeta = [
    { key: 'toggle_mirror', title: 'Start / Stop Mirroring', desc: 'Connects or disconnects the active screen mirror session.' },
    { key: 'screenshot', title: 'Take Instant Screenshot', desc: 'Captures lossless PNG frame directly to the screenshot folder.' },
    { key: 'toggle_recording', title: 'Start / Stop Recording', desc: 'Toggles high-definition video recording to disk.' },
    { key: 'toggle_fullscreen', title: 'Toggle Fullscreen Mode', desc: 'Switches the mirror window to borderless full display.' },
    { key: 'screen_off', title: 'Turn Off Android Screen', desc: 'Puts phone screen to sleep while keeping PC mirror active.' },
    { key: 'volume_up', title: 'Volume Up', desc: 'Increases device audio stream level.' },
    { key: 'volume_down', title: 'Volume Down', desc: 'Decreases device audio stream level.' }
  ];

  tbody.innerHTML = actionsMeta.map(meta => {
    const keys = AppState.shortcuts[meta.key] || ['Unassigned'];
    const keysHtml = keys.map((k, idx) => `
      <kbd class="key-chip">${k}</kbd>
      ${idx < keys.length - 1 ? '<span class="key-plus">+</span>' : ''}
    `).join('');

    return `
      <tr data-action="${meta.key}">
        <td>
          <div class="shortcut-meta">
            <span class="shortcut-title">${meta.title}</span>
            <span class="shortcut-desc">${meta.desc}</span>
          </div>
        </td>
        <td>
          <div class="keybind-recorder" onclick="startRecordingKey(this, '${meta.key}')">
            ${keysHtml}
            <i class="ri-edit-line edit-icon"></i>
          </div>
        </td>
        <td style="text-align: right;">
          <span class="badge-status enabled">Active</span>
        </td>
      </tr>
    `;
  }).join('');
}

// ==========================================================================
// 5.5 Hardware GPU Decoder Dynamic Detection & Selection
// ==========================================================================
let gLastGpuInfo = null;

function updateGpuDecoderUI(gpuData) {
  if (!gpuData) return;
  gLastGpuInfo = gpuData;

  const select = document.getElementById('videoDecoderSelect');
  const badge = document.getElementById('gpuDetectedBadge');
  const subtitle = document.getElementById('hardwareDecoderSubtitle');

  if (!select) return;

  const hasHw = !!gpuData.hasHardwareGpu;
  const isSoftwareActive = (gpuData.activeDecoder === 'software') || (AppState.video.decoder === 'software');

  select.innerHTML = '';

  if (hasHw) {
    select.disabled = false;

    // Populate all available hardware GPUs
    if (Array.isArray(gpuData.gpus) && gpuData.gpus.length > 0) {
      gpuData.gpus.forEach((gpu) => {
        const opt = document.createElement('option');
        opt.value = `gpu_${gpu.index}`;
        const typeLabel = gpu.isDedicated ? 'Dedicated GPU' : 'Integrated GPU';
        const vrLabel = gpu.vramMB > 0 ? ` - ${gpu.vramMB} MB` : '';
        opt.textContent = `${gpu.name} (${typeLabel}${vrLabel} - Hardware Accelerated)`;
        select.appendChild(opt);
      });
    } else {
      const activeGpu = (gpuData.activeGpu ? gpuData.activeGpu.trim() : 'Direct3D 11 GPU');
      const optHw = document.createElement('option');
      optHw.value = 'gpu_0';
      optHw.textContent = `${activeGpu} (Hardware Accelerated - D3D11VA)`;
      select.appendChild(optHw);
    }

    // Always offer Software fallback
    const optSw = document.createElement('option');
    optSw.value = 'software';
    optSw.textContent = 'Software Decoding (FFmpeg Multi-Threaded CPU)';
    select.appendChild(optSw);

    if (isSoftwareActive) {
      select.value = 'software';
      AppState.video.decoder = 'software';
      if (subtitle) {
        subtitle.textContent = 'Multi-threaded CPU software decoding active (FFmpeg).';
      }
      if (badge) {
        badge.style.display = 'block';
        badge.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 6px; color: #3b82f6; font-size: 11.5px; font-weight: 500; padding: 4px 8px; border-radius: 6px; background: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.25);">
          <i class="ri-cpu-line"></i> CPU Software Decoding Active (Multi-Threaded FFmpeg)
        </span>`;
      }
    } else {
      // Determine which GPU option to select
      let targetVal = AppState.video.decoder;
      if (!targetVal || targetVal === 'software' || !select.querySelector(`option[value="${targetVal}"]`)) {
        if (gpuData.activeGpuIndex !== undefined && gpuData.activeGpuIndex >= 0 && select.querySelector(`option[value="gpu_${gpuData.activeGpuIndex}"]`)) {
          targetVal = `gpu_${gpuData.activeGpuIndex}`;
        } else {
          targetVal = select.options[0].value;
        }
      }
      select.value = targetVal;
      AppState.video.decoder = select.value;

      // Find current selected GPU details for subtitle & badge
      let activeGpuName = gpuData.activeGpu || '';
      let activeVram = gpuData.vramMB || 0;
      if (select.value.startsWith('gpu_') && Array.isArray(gpuData.gpus)) {
        const idx = parseInt(select.value.replace('gpu_', ''), 10);
        const matchGpu = gpuData.gpus.find(g => g.index === idx);
        if (matchGpu) {
          activeGpuName = matchGpu.name;
          activeVram = matchGpu.vramMB;
        }
      }
      const vramText = activeVram > 0 ? ` (${activeVram} MB VRAM)` : '';

      if (subtitle) {
        subtitle.textContent = `Active GPU: ${activeGpuName}${vramText}`;
      }
      if (badge) {
        badge.style.display = 'block';
        badge.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 6px; color: #10b981; font-size: 11.5px; font-weight: 500; padding: 4px 8px; border-radius: 6px; background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.25);">
          <i class="ri-checkbox-circle-fill"></i> System GPU Active: <strong>${escHtml(activeGpuName)}</strong>${escHtml(vramText)}
        </span>`;
      }
    }
  } else {
    // "agr nhi he to ye option mt do" -> Hardware acceleration unavailable, DO NOT OFFER IT!
    const optSw = document.createElement('option');
    optSw.value = 'software';
    optSw.textContent = 'Software Decoding (FFmpeg Multi-Threaded CPU)';
    optSw.selected = true;
    select.appendChild(optSw);

    select.value = 'software';
    AppState.video.decoder = 'software';
    select.disabled = true; // Hardware option is completely removed and locked to software!

    if (subtitle) {
      subtitle.textContent = 'Hardware GPU acceleration unavailable. CPU decoding active.';
    }

    if (badge) {
      badge.style.display = 'block';
      badge.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 6px; color: #f59e0b; font-size: 11.5px; font-weight: 500; padding: 4px 8px; border-radius: 6px; background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.25);">
        <i class="ri-alert-fill"></i> No compatible hardware GPU detected. Operating in multi-threaded CPU software mode.
      </span>`;
    }
  }
}

// ==========================================================================
// 6. UI Sync from State & Page Actions
// ==========================================================================
function syncUIFromState() {
  // Video
  const resBtn = document.querySelector(`#videoResolutionControl .segment-btn[data-value="${AppState.video.resolution}"]`);
  if (resBtn) {
    document.querySelectorAll('#videoResolutionControl .segment-btn').forEach(b => b.classList.remove('active'));
    resBtn.classList.add('active');
  }

  const fpsBtn = document.querySelector(`#videoFpsGroup .pill-btn[data-fps="${AppState.video.fps}"]`);
  if (fpsBtn) {
    document.querySelectorAll('#videoFpsGroup .pill-btn').forEach(b => b.classList.remove('active'));
    fpsBtn.classList.add('active');
  }

  const bitrateSlider = document.getElementById('videoBitrateSlider');
  const bitrateBadge = document.getElementById('videoBitrateBadge');
  if (bitrateSlider && bitrateBadge) {
    bitrateSlider.value = AppState.video.bitrate;
    const suffix = AppState.video.bitrate >= 50 ? ' (4K Cinema Bitrate)' : (AppState.video.bitrate >= 35 ? ' (2K Ultra Quality)' : (AppState.video.bitrate >= 20 ? ' (FHD Quality)' : ' (Lite)'));
    bitrateBadge.textContent = `${AppState.video.bitrate} Mbps${suffix}`;
  }

  if (gLastGpuInfo) {
    updateGpuDecoderUI(gLastGpuInfo);
  } else {
    const videoDec = document.getElementById('videoDecoderSelect');
    if (videoDec) videoDec.value = AppState.video.decoder;
  }

  const videoCodec = document.getElementById('videoCodecSelect');
  if (videoCodec) videoCodec.value = AppState.video.codec;

  const lowLat = document.getElementById('toggleLowLatency');
  if (lowLat) lowLat.checked = AppState.video.lowLatency;

  const vsync = document.getElementById('toggleVsync');
  if (vsync) vsync.checked = AppState.video.vsync;

  // General
  const lang = document.getElementById('generalLanguageSelect');
  if (lang) lang.value = AppState.general.language;

  const startup = document.getElementById('toggleStartup');
  if (startup) startup.checked = AppState.general.startup;

  const tray = document.getElementById('toggleTray');
  if (tray) tray.checked = AppState.general.tray;

  const closeToTray = document.getElementById('toggleCloseToTray');
  if (closeToTray) closeToTray.checked = AppState.general.closeToTray;

  const alwaysOnTop = document.getElementById('toggleAlwaysOnTop');
  if (alwaysOnTop) alwaysOnTop.checked = AppState.general.alwaysOnTop;

  const connNotify = document.getElementById('toggleConnNotify');
  if (connNotify) connNotify.checked = AppState.general.connNotify;

  const recNotify = document.getElementById('toggleRecNotify');
  if (recNotify) recNotify.checked = AppState.general.recNotify;

  const logLvl = document.getElementById('generalLogLevel');
  if (logLvl) logLvl.value = AppState.general.logLevel;

  // Recording
  const recPath = document.getElementById('recOutputPath');
  if (recPath) recPath.value = AppState.recording.outputPath;

  const recFmt = document.getElementById('recFormatSelect');
  if (recFmt) recFmt.value = AppState.recording.format;

  const recQual = document.getElementById('recQualityPreset');
  if (recQual) recQual.value = AppState.recording.quality;

  const recAudio = document.getElementById('recAudioSource');
  if (recAudio) recAudio.value = AppState.recording.audioSource;

  const recAudioBit = document.getElementById('recAudioBitrate');
  if (recAudioBit) recAudioBit.value = AppState.recording.audioBitrate;

  const autoSplit = document.getElementById('toggleAutoSplit');
  if (autoSplit) autoSplit.checked = AppState.recording.autoSplit;

  const watermark = document.getElementById('toggleWatermark');
  if (watermark) watermark.checked = AppState.recording.watermark;
  renderShortcutsTable();
}

window.savePage = function (pageName) {
  // Collect state for specific page
  if (pageName === 'video') {
    AppState.video.decoder = document.getElementById('videoDecoderSelect')?.value || 'd3d11va';
    LoccoHost.send('set_decoder', { decoder: AppState.video.decoder });
    AppState.video.codec = document.getElementById('videoCodecSelect')?.value || 'h264';
    AppState.video.lowLatency = document.getElementById('toggleLowLatency')?.checked ?? true;
    AppState.video.vsync = document.getElementById('toggleVsync')?.checked ?? false;
    const dim = getResolutionDimensions(AppState.video.resolution);
    LoccoHost.send('set_video_config', {
      resolution: AppState.video.resolution || '1080p',
      width: dim.width,
      height: dim.height,
      fps: AppState.video.fps || 60,
      bitrate: (AppState.video.bitrate || 8) * 1000000
    });
    LoccoHost.send('set_resolution', { resolution: AppState.video.resolution || '1080p' });
  } else if (pageName === 'general') {
    AppState.general.language = document.getElementById('generalLanguageSelect')?.value || 'en';
    AppState.general.startup = document.getElementById('toggleStartup')?.checked ?? false;
    AppState.general.tray = document.getElementById('toggleTray')?.checked ?? true;
    AppState.general.closeToTray = document.getElementById('toggleCloseToTray')?.checked ?? true;
    AppState.general.alwaysOnTop = document.getElementById('toggleAlwaysOnTop')?.checked ?? false;
    AppState.general.connNotify = document.getElementById('toggleConnNotify')?.checked ?? true;
    AppState.general.recNotify = document.getElementById('toggleRecNotify')?.checked ?? true;
    AppState.general.logLevel = document.getElementById('generalLogLevel')?.value || 'info';
  } else if (pageName === 'recording') {
    AppState.recording.format = document.getElementById('recFormatSelect')?.value || 'mp4';
    AppState.recording.quality = document.getElementById('recQualityPreset')?.value || 'original';
    AppState.recording.audioSource = document.getElementById('recAudioSource')?.value || 'both';
    AppState.recording.audioBitrate = document.getElementById('recAudioBitrate')?.value || '192';
    AppState.recording.autoSplit = document.getElementById('toggleAutoSplit')?.checked ?? false;
    AppState.recording.watermark = document.getElementById('toggleWatermark')?.checked ?? false;
  }

  persistConfig();
  showToast(`${pageName.toUpperCase()} settings saved and applied!`);
};

window.resetPage = function (pageName) {
  if (DEFAULT_CONFIG[pageName]) {
    AppState[pageName] = JSON.parse(JSON.stringify(DEFAULT_CONFIG[pageName]));
    syncUIFromState();
    persistConfig();
    if (pageName === 'video') {
      const dim = getResolutionDimensions(AppState.video.resolution);
      LoccoHost.send('set_video_config', {
        resolution: AppState.video.resolution,
        width: dim.width,
        height: dim.height,
        fps: AppState.video.fps || 60,
        bitrate: (AppState.video.bitrate || 8) * 1000000
      });
      LoccoHost.send('set_resolution', { resolution: AppState.video.resolution });
    }
    showToast(`${pageName.toUpperCase()} settings reset to defaults.`);
  }
};

// ==========================================================================
// 7. Toast Alerts System
// ==========================================================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const iconClass = type === 'success' ? 'ri-checkbox-circle-line' : (type === 'error' ? 'ri-error-warning-line' : 'ri-information-line');
  const toast = document.createElement('div');
  toast.className = `toast-message ${type}`;
  toast.innerHTML = `
    <i class="${iconClass} toast-icon"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// ==========================================================================
// 8. Floating Toolbar & Quick Actions
// ==========================================================================
let isWindowPinned = false;

function initDouWanToolbar() {
  // 1. Rotate 90 deg
  const handleRotate = () => {
    LoccoHost.send('rotate_display');
    showToast('Display rotated 90° clockwise');
  };
  document.getElementById('btnHeaderRotate')?.addEventListener('click', handleRotate);
  document.getElementById('btnTbRotate')?.addEventListener('click', handleRotate);

  // 2. Fullscreen toggle
  let isFullscreenActive = false;
  const handleFullscreen = () => {
    isFullscreenActive = !isFullscreenActive;
    LoccoHost.send('toggle_fullscreen');
    const fsHeader = document.getElementById('btnHeaderFullscreen');
    const fsTb = document.getElementById('btnTbFullscreen');
    if (isFullscreenActive) {
      fsHeader?.classList.add('active');
      fsTb?.classList.add('active');
      showToast('Borderless Fullscreen: ON');
    } else {
      fsHeader?.classList.remove('active');
      fsTb?.classList.remove('active');
      showToast('Borderless Fullscreen: OFF');
    }
  };
  document.getElementById('btnHeaderFullscreen')?.addEventListener('click', handleFullscreen);
  document.getElementById('btnTbFullscreen')?.addEventListener('click', handleFullscreen);

  // 3. Always-on-top Pin toggle
  const handlePin = () => {
    isWindowPinned = !isWindowPinned;
    LoccoHost.send('toggle_pin', { isPinned: isWindowPinned });
    const pinHeader = document.getElementById('btnHeaderPin');
    const pinTb = document.getElementById('btnTbPin');
    if (isWindowPinned) {
      pinHeader?.classList.add('active');
      pinTb?.classList.add('active');
      showToast('Always on Top: ENABLED');
    } else {
      pinHeader?.classList.remove('active');
      pinTb?.classList.remove('active');
      showToast('Always on Top: DISABLED');
    }
  };
  document.getElementById('btnHeaderPin')?.addEventListener('click', handlePin);
  document.getElementById('btnTbPin')?.addEventListener('click', handlePin);

  // 4. Auto-Aspect Ratio Snap
  const handleSnap = () => {
    LoccoHost.send('snap_aspect_ratio');
    showToast('Window snapped to mobile aspect ratio');
  };
  document.getElementById('btnHeaderSnap')?.addEventListener('click', handleSnap);
  document.getElementById('btnTbSnap')?.addEventListener('click', handleSnap);

  // 5. Phone Screen Sleep (Blackout)
  const handleSleep = () => {
    LoccoHost.send('screen_sleep');
    showToast('Dispatched Screen Sleep to device');
  };
  document.getElementById('btnHeaderSleep')?.addEventListener('click', handleSleep);
  document.getElementById('btnTbSleep')?.addEventListener('click', handleSleep);

  // 6. Screenshot
  const handleScreenshot = () => {
    LoccoHost.send('take_screenshot');
    showToast('Screenshot saved to Pictures/loccoMirror!');
  };
  document.getElementById('btnHeaderScreenshot')?.addEventListener('click', handleScreenshot);
  document.getElementById('btnTbScreenshot')?.addEventListener('click', handleScreenshot);

  // 7. Quick Volume Slider
  const tbQuickVol = document.getElementById('tbQuickVolume');
  const tbQuickVolLbl = document.getElementById('tbQuickVolumeLabel');
  if (tbQuickVol) {
    tbQuickVol.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (tbQuickVolLbl) tbQuickVolLbl.textContent = `${val}%`;
      LoccoHost.send('set_volume', { volume: val / 100.0 });
    });
  }
}

// ==========================================================================
// 8.5. Devices Page — ADB Multi-Device Discovery & Connection
// ==========================================================================
function initDevicesPage() {
  let deviceList = [];
  let refreshInterval = null;
  let pendingSerial = null;

  const listContainer  = document.getElementById('deviceListContainer');
  const emptyState     = document.getElementById('deviceListEmpty');
  const refreshBtn     = document.getElementById('btnRefreshDevices');
  const scanSpinner    = document.getElementById('deviceScanSpinner');

  function renderDevices(devices) {
    if (!listContainer) return;
    listContainer.innerHTML = '';

    if (!devices || devices.length === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      return;
    }
    if (emptyState) emptyState.style.display = 'none';

    devices.forEach(dev => {
      const isConnected = dev.isActive;
      const stateColor  = dev.state === 'Connected' ? '#10b981' :
                          dev.state === 'Unauthorized' ? '#f59e0b' : '#64748b';

      const badge = dev.hwBadge || (dev.state === 'Connected' ? '4K Ready' : dev.state);
      const badgeClass = badge.includes('Max') ? 'badge-limit' :
                         badge.includes('4K')  ? 'badge-4k'    :
                         badge.includes('2K')  ? 'badge-2k'    : 'badge-hd';

      const card = document.createElement('div');
      card.className = `device-card${isConnected ? ' device-card--active' : ''}`;
      card.dataset.serial = dev.serial;
      card.innerHTML = `
        <div class="device-card__icon">
          <i class="${dev.transport === 'tcp' ? 'ri-wifi-line' : 'ri-usb-line'}"></i>
        </div>
        <div class="device-card__info">
          <div class="device-card__name">${escHtml(dev.model || dev.serial)}</div>
          <div class="device-card__meta">
            <span class="device-serial">${escHtml(dev.serial)}</span>
            ${dev.androidVersion ? `<span class="device-android">Android ${escHtml(dev.androidVersion)}</span>` : ''}
          </div>
        </div>
        <div class="device-card__badges">
          <span class="device-state-dot" style="background:${stateColor}"></span>
          <span class="device-hw-badge ${badgeClass}">${escHtml(badge)}</span>
        </div>
        <button class="device-connect-btn${isConnected ? ' device-connect-btn--stop' : ''}" data-serial="${escHtml(dev.serial)}">
          <i class="${isConnected ? 'ri-stop-circle-line' : 'ri-play-circle-line'}"></i>
          <span>${isConnected ? 'Disconnect' : 'Connect'}</span>
        </button>
      `;

      const connectBtn = card.querySelector('.device-connect-btn');
      connectBtn?.addEventListener('click', () => {
        if (isConnected) {
          LoccoHost.send('disconnect_device', { serial: dev.serial });
          showToast(`Disconnecting ${dev.model || dev.serial}...`, 'info');
        } else {
          pendingSerial = dev.serial;
          LoccoHost.send('connect_device', { serial: dev.serial });
          showToast(`Connecting to ${dev.model || dev.serial}...`, 'info');
          // Optimistically mark connecting
          connectBtn.disabled = true;
          connectBtn.innerHTML = '<i class="ri-loader-4-line spin-animation"></i><span>Connecting...</span>';
        }
      });

      listContainer.appendChild(card);
    });
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function refreshDeviceList() {
    if (scanSpinner) scanSpinner.style.display = 'flex';
    LoccoHost.send('get_devices', {});
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshDeviceList();
      showToast('Scanning for Android devices...', 'info');
    });
  }

  // Start auto-refresh when the Devices tab is visible
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.page === 'devices') {
        refreshDeviceList();
        if (!refreshInterval)
          refreshInterval = setInterval(refreshDeviceList, 3000);
      } else {
        if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
      }
    });
  });

  // Handle IPC replies from C++ host
  LoccoHost.onMessage((data) => {
    if (!data) return;

    if (data.type === 'device_list') {
      if (scanSpinner) scanSpinner.style.display = 'none';
      deviceList = Array.isArray(data.devices) ? data.devices : [];
      renderDevices(deviceList);

      // Update global navbar badge with first connected device
      const globalBadge = document.getElementById('globalDeviceBadge');
      if (globalBadge) {
        const activeDev = deviceList.find(d => d.isActive || d.state === 'Connected') || deviceList[0];
        if (activeDev) {
          const devName = activeDev.model || activeDev.serial;
          globalBadge.className = 'device-status-badge live';
          globalBadge.innerHTML = `<span class="status-pip"></span><span class="status-text">${escHtml(devName)}</span>`;
        }
      }
    }

    if (data.type === 'device_connected') {
      const { serial, success, hwBadge } = data;
      if (success) {
        // Update badge on the negotiated device
        deviceList = deviceList.map(d => ({
          ...d,
          isActive: d.serial === serial,
          hwBadge: d.serial === serial ? (hwBadge || d.hwBadge) : d.hwBadge
        }));
        renderDevices(deviceList);
        showToast(`Connected: ${hwBadge || ''}`, 'success');
      } else {
        showToast('Device connection failed — check USB & ADB authorization', 'error');
        renderDevices(deviceList); // re-render to reset button state
      }
      pendingSerial = null;
    }

    if (data.type === 'negotiated_codec') {
      // Update hw badge from Android's CodecCapabilityProber result
      const { serial, badge } = data;
      deviceList = deviceList.map(d => d.serial === serial ? { ...d, hwBadge: badge } : d);
      renderDevices(deviceList);

      const globalBadge = document.getElementById('globalDeviceBadge');
      if (globalBadge && badge) {
        const existingText = globalBadge.querySelector('.status-text');
        if (existingText && badge) {
          existingText.textContent = existingText.textContent.replace(/ • .*$/, '') + ` • ${badge}`;
        }
      }
    }
  });

  // Initial load if page opens on devices hash
  if (window.location.hash === '#devices') refreshDeviceList();
}

// ==========================================================================
// 8. User Authentication & Cloud MongoDB Backend Integration
// ==========================================================================
const DEFAULT_API_BASE_URL = 'https://loccomirror-api.vercel.app';

const AuthStore = {
  getApiUrl: () => localStorage.getItem('loccomirror_api_url') || DEFAULT_API_BASE_URL,
  setApiUrl: (url) => localStorage.setItem('loccomirror_api_url', url.trim().replace(/\/+$/, '')),
  
  getToken: () => localStorage.getItem('loccomirror_auth_token') || '',
  setToken: (token) => localStorage.setItem('loccomirror_auth_token', token),
  removeToken: () => localStorage.removeItem('loccomirror_auth_token'),
  
  getUser: () => {
    try {
      const u = localStorage.getItem('loccomirror_user_profile');
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  },
  setUser: (user) => localStorage.setItem('loccomirror_user_profile', JSON.stringify(user)),
  removeUser: () => localStorage.removeItem('loccomirror_user_profile')
};

function initAuthentication() {
  const btnAuthTrigger = document.getElementById('btnAuthTrigger');
  const userProfileMenu = document.getElementById('userProfileMenu');
  const authBtnText = document.getElementById('authBtnText');
  const authBtnIcon = document.getElementById('authBtnIcon');
  const userPlanTag = document.getElementById('userPlanTag');

  const profileMenuAvatar = document.getElementById('profileMenuAvatar');
  const profileMenuName = document.getElementById('profileMenuName');
  const profileMenuEmail = document.getElementById('profileMenuEmail');
  const profileMenuPlan = document.getElementById('profileMenuPlan');

  const authModalOverlay = document.getElementById('authModalOverlay');
  const authModalClose = document.getElementById('authModalClose');
  const tabBtnSignIn = document.getElementById('tabBtnSignIn');
  const tabBtnSignUp = document.getElementById('tabBtnSignUp');
  const formSignIn = document.getElementById('formSignIn');
  const formSignUp = document.getElementById('formSignUp');

  const btnSignInSubmit = document.getElementById('btnSignInSubmit');
  const btnSignUpSubmit = document.getElementById('btnSignUpSubmit');
  const spinnerSignIn = document.getElementById('spinnerSignIn');
  const spinnerSignUp = document.getElementById('spinnerSignUp');

  const toggleSignInPwd = document.getElementById('toggleSignInPwd');
  const toggleSignUpPwd = document.getElementById('toggleSignUpPwd');
  const signInPassword = document.getElementById('signInPassword');
  const signUpPassword = document.getElementById('signUpPassword');

  const btnSignOut = document.getElementById('btnSignOut');
  const btnOpenApiConfig = document.getElementById('btnOpenApiConfig');
  const apiConfigModalOverlay = document.getElementById('apiConfigModalOverlay');
  const apiConfigModalClose = document.getElementById('apiConfigModalClose');
  const inputBackendUrl = document.getElementById('inputBackendUrl');
  const btnTestApiConnection = document.getElementById('btnTestApiConnection');
  const btnSaveApiConfig = document.getElementById('btnSaveApiConfig');
  const apiStatusIndicator = document.getElementById('apiStatusIndicator');
  const apiStatusText = document.getElementById('apiStatusText');

  // ── Render User State in Header & Menu ──
  function updateAuthStateUI(user) {
    if (user && user.email) {
      const displayName = user.name || user.email.split('@')[0];
      const firstName = displayName.split(' ')[0];
      if (authBtnText) authBtnText.textContent = firstName;
      if (authBtnIcon) authBtnIcon.className = 'auth-icon ri-shield-check-line';
      if (userPlanTag) {
        userPlanTag.textContent = (user.plan || 'free').toUpperCase();
        userPlanTag.classList.remove('hidden');
      }

      if (profileMenuName) profileMenuName.textContent = displayName;
      if (profileMenuEmail) profileMenuEmail.textContent = user.email;
      if (profileMenuPlan) profileMenuPlan.textContent = (user.plan === 'pro') ? '⭐ Pro VIP Tier' : 'Free Tier';
      if (profileMenuAvatar && user.avatar) profileMenuAvatar.src = user.avatar;
    } else {
      if (authBtnText) authBtnText.textContent = 'Sign In';
      if (authBtnIcon) authBtnIcon.className = 'auth-icon ri-account-circle-line';
      if (userPlanTag) userPlanTag.classList.add('hidden');

      if (profileMenuName) profileMenuName.textContent = 'Guest User';
      if (profileMenuEmail) profileMenuEmail.textContent = 'Not logged in';
      if (profileMenuPlan) profileMenuPlan.textContent = 'Guest';
      if (profileMenuAvatar) profileMenuAvatar.src = 'logo.png';
    }

    // Notify C++ Host Bridge to toggle watermark on screen mirror player
    const isLoggedIn = !!(user && user.email);
    LoccoHost.send('user_auth_state', { isLoggedIn, email: user ? user.email : null });
  }

  // ── Modal Open / Close / Switch ──
  function openAuthModal(tab = 'signin') {
    userProfileMenu?.classList.add('hidden');
    authModalOverlay?.classList.remove('hidden');
    switchAuthTab(tab);
  }

  function closeAuthModal() {
    authModalOverlay?.classList.add('hidden');
  }

  function switchAuthTab(tab) {
    if (tab === 'signin') {
      tabBtnSignIn?.classList.add('active');
      tabBtnSignUp?.classList.remove('active');
      formSignIn?.classList.remove('hidden');
      formSignUp?.classList.add('hidden');
      document.getElementById('signInEmail')?.focus();
    } else {
      tabBtnSignUp?.classList.add('active');
      tabBtnSignIn?.classList.remove('active');
      formSignUp?.classList.remove('hidden');
      formSignIn?.classList.add('hidden');
      document.getElementById('signUpName')?.focus();
    }
  }

  // Header button click: If logged in, toggle profile dropdown. If not, open modal.
  btnAuthTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    const token = AuthStore.getToken();
    if (token) {
      userProfileMenu?.classList.toggle('hidden');
    } else {
      openAuthModal('signin');
    }
  });

  // Close profile dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (userProfileMenu && !userProfileMenu.contains(e.target) && !btnAuthTrigger.contains(e.target)) {
      userProfileMenu.classList.add('hidden');
    }
  });

  authModalClose?.addEventListener('click', closeAuthModal);
  authModalOverlay?.addEventListener('click', (e) => {
    if (e.target === authModalOverlay) closeAuthModal();
  });

  tabBtnSignIn?.addEventListener('click', () => switchAuthTab('signin'));
  tabBtnSignUp?.addEventListener('click', () => switchAuthTab('signup'));

  // Show/Hide Password toggles
  toggleSignInPwd?.addEventListener('click', () => {
    if (!signInPassword) return;
    const isPwd = signInPassword.type === 'password';
    signInPassword.type = isPwd ? 'text' : 'password';
    const icon = toggleSignInPwd.querySelector('i');
    if (icon) icon.className = isPwd ? 'ri-eye-off-line' : 'ri-eye-line';
  });

  toggleSignUpPwd?.addEventListener('click', () => {
    if (!signUpPassword) return;
    const isPwd = signUpPassword.type === 'password';
    signUpPassword.type = isPwd ? 'text' : 'password';
    const icon = toggleSignUpPwd.querySelector('i');
    if (icon) icon.className = isPwd ? 'ri-eye-off-line' : 'ri-eye-line';
  });

  // ── Form Submissions (Sign In & Sign Up) ──
  formSignIn?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('signInEmail')?.value.trim();
    const password = document.getElementById('signInPassword')?.value;

    if (!email || !password) {
      showToast('Please enter both email and password.', 'error');
      return;
    }

    if (btnSignInSubmit) btnSignInSubmit.disabled = true;
    if (spinnerSignIn) spinnerSignIn.classList.remove('hidden');

    try {
      const baseUrl = AuthStore.getApiUrl();
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Login failed. Please check your credentials.');
      }

      AuthStore.setToken(data.token);
      AuthStore.setUser(data.user);
      updateAuthStateUI(data.user);
      closeAuthModal();
      showToast(`Welcome back, ${data.user.name || 'User'}! 🎉`, 'info');
    } catch (err) {
      console.error('[Auth Sign In Error]:', err);
      showToast(err.message || 'Failed to connect to authentication server.', 'error');
    } finally {
      if (btnSignInSubmit) btnSignInSubmit.disabled = false;
      if (spinnerSignIn) spinnerSignIn.classList.add('hidden');
    }
  });

  formSignUp?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('signUpName')?.value.trim();
    const email = document.getElementById('signUpEmail')?.value.trim();
    const password = document.getElementById('signUpPassword')?.value;
    const confirmPassword = document.getElementById('signUpConfirmPassword')?.value;

    if (!name || !email || !password) {
      showToast('Please fill out all required fields.', 'error');
      return;
    }

    if (password !== confirmPassword) {
      showToast('Passwords do not match. Please re-enter.', 'error');
      return;
    }

    if (password.length < 6) {
      showToast('Password must be at least 6 characters long.', 'error');
      return;
    }

    if (btnSignUpSubmit) btnSignUpSubmit.disabled = true;
    if (spinnerSignUp) spinnerSignUp.classList.remove('hidden');

    try {
      const baseUrl = AuthStore.getApiUrl();
      const res = await fetch(`${baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Signup failed. Please try again.');
      }

      AuthStore.setToken(data.token);
      AuthStore.setUser(data.user);
      updateAuthStateUI(data.user);
      closeAuthModal();
      showToast(`Account created! Welcome to loccoMirror, ${data.user.name}! 🚀`, 'info');
    } catch (err) {
      console.error('[Auth Sign Up Error]:', err);
      showToast(err.message || 'Failed to create account.', 'error');
    } finally {
      if (btnSignUpSubmit) btnSignUpSubmit.disabled = false;
      if (spinnerSignUp) spinnerSignUp.classList.add('hidden');
    }
  });

  // ── Sign Out ──
  btnSignOut?.addEventListener('click', () => {
    AuthStore.removeToken();
    AuthStore.removeUser();
    updateAuthStateUI(null);
    userProfileMenu?.classList.add('hidden');
    showToast('You have been signed out.', 'info');
  });

  // ── API Configuration Dialog ──
  btnOpenApiConfig?.addEventListener('click', () => {
    userProfileMenu?.classList.add('hidden');
    if (inputBackendUrl) inputBackendUrl.value = AuthStore.getApiUrl();
    apiConfigModalOverlay?.classList.remove('hidden');
    testBackendApi();
  });

  apiConfigModalClose?.addEventListener('click', () => {
    apiConfigModalOverlay?.classList.add('hidden');
  });

  apiConfigModalOverlay?.addEventListener('click', (e) => {
    if (e.target === apiConfigModalOverlay) apiConfigModalOverlay.classList.add('hidden');
  });

  async function testBackendApi() {
    const url = (inputBackendUrl?.value || AuthStore.getApiUrl()).trim().replace(/\/+$/, '');
    if (apiStatusIndicator) apiStatusIndicator.className = 'api-status-indicator';
    if (apiStatusText) apiStatusText.textContent = 'Testing connection to server...';

    const startTime = performance.now();
    try {
      const res = await fetch(`${url}/api/auth/health`, { method: 'GET' });
      const elapsed = Math.round(performance.now() - startTime);
      if (res.ok) {
        if (apiStatusIndicator) apiStatusIndicator.className = 'api-status-indicator online';
        if (apiStatusText) apiStatusText.textContent = `Online (${elapsed}ms) • MongoDB Gateway Ready`;
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      if (apiStatusIndicator) apiStatusIndicator.className = 'api-status-indicator offline';
      if (apiStatusText) apiStatusText.textContent = `Offline or Unreachable (${err.message}). Check Vercel URL.`;
    }
  }

  btnTestApiConnection?.addEventListener('click', testBackendApi);

  btnSaveApiConfig?.addEventListener('click', () => {
    const newUrl = inputBackendUrl?.value.trim();
    if (newUrl) {
      AuthStore.setApiUrl(newUrl);
      showToast(`Backend API URL updated to: ${newUrl}`, 'info');
      apiConfigModalOverlay?.classList.add('hidden');
    }
  });

  // ── Auto Restore Session Verification on Start ──
  const storedUser = AuthStore.getUser();
  const storedToken = AuthStore.getToken();
  if (storedUser) {
    updateAuthStateUI(storedUser);
  } else {
    updateAuthStateUI(null);
  }

  if (storedToken) {
    const baseUrl = AuthStore.getApiUrl();
    fetch(`${baseUrl}/api/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${storedToken}`
      }
    })
    .then((r) => r.json())
    .then((d) => {
      if (d.success && d.user) {
        AuthStore.setUser(d.user);
        updateAuthStateUI(d.user);
      } else {
        // Token invalid/expired
        AuthStore.removeToken();
        AuthStore.removeUser();
        updateAuthStateUI(null);
      }
    })
    .catch((err) => {
      console.warn('[Session Verify]: Backend offline or unreachable, keeping cached user state.', err);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  bindInteractiveControls();
  initDouWanToolbar();
  initDevicesPage();
  initAuthentication();
  syncUIFromState();
  LoccoHost.send('get_gpu_info', {});

  // Listen to Host Events (Telemetry, Device Status, etc.)
  LoccoHost.onMessage((data) => {
    if (!data) return;

    if (data.type === 'telemetry_update') {
      const badge = document.getElementById('globalDeviceBadge');
      if (badge) {
        const rawName = data.device_name ? data.device_name.trim() : '';
        if (rawName.length > 0) {
          const fpsText = data.fps !== undefined && data.fps > 0 ? `${data.fps} FPS` : 'Connected';
          badge.className = 'device-status-badge live';
          badge.innerHTML = `<span class="status-pip"></span><span class="status-text">${escHtml(rawName)} (${fpsText})</span>`;
        } else {
          badge.className = 'device-status-badge offline';
          badge.innerHTML = `<span class="status-pip offline"></span><span class="status-text">No Device Connected</span>`;
        }
      }
    } else if (data.type === 'device_status') {
      const badge = document.getElementById('globalDeviceBadge');
      if (badge && data.device) {
        const fpsText = data.device.fps && data.device.fps > 0 ? `${data.device.fps} FPS` : 'Connected';
        badge.className = 'device-status-badge live';
        badge.innerHTML = `<span class="status-pip"></span><span class="status-text">${escHtml(data.device.name)} (${fpsText})</span>`;
      }
    } else if (data.type === 'gpu_info') {
      updateGpuDecoderUI(data);
    }
  });

  console.log('loccoMirror Frontend initialized for WebView2');
});

