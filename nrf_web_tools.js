
class NrfWebTools {
  constructor(buttonElement, zipPath) {
    this.button = buttonElement;
    this.zipPath = zipPath;
    this.modal = null;
    this.firmwareQueue = [];
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.rxBuf = [];
    this.hciSequenceNumber = 0;
    this.resolveAck = null;
    this.ackTimeout = null;
    this.currentState = 'WELCOME'; // WELCOME, LOADING, INSTALLING, WAITING_CONTINUE, WAITING_RECONNECT, SUCCESS, ERROR
    this.flashState = null; // Store state for continuing after reset
    this.currentFirmwareIndex = 0; // Track which firmware we're currently flashing
    
    // Constants
    this.SLIP_END = 0xC0;
    this.SLIP_ESC = 0xDB;
    this.SLIP_ESC_END = 0xDC;
    this.SLIP_ESC_ESC = 0xDD;
    
    this.DATA_INTEGRITY_CHECK_PRESENT = 1;
    this.RELIABLE_PACKET = 1;
    this.HCI_PACKET_TYPE = 14;
    
    this.DFU_INIT_PACKET = 1;
    this.DFU_START_PACKET = 3;
    this.DFU_DATA_PACKET = 4;
    this.DFU_STOP_DATA_PACKET = 5;
    
    this.DFU_UPDATE_MODE_NONE = 0;
    this.DFU_UPDATE_MODE_SD = 1;
    this.DFU_UPDATE_MODE_BL = 2;
    this.DFU_UPDATE_MODE_APP = 4;
    this.DFU_UPDATE_MODE_SD_BL = 3;
    
    this.FLASH_PAGE_SIZE = 4096;
    this.FLASH_PAGE_ERASE_TIME = 0.0897;
    this.FLASH_WORD_WRITE_TIME = 0.000100;
    this.FLASH_PAGE_WRITE_TIME = (this.FLASH_PAGE_SIZE / 4) * this.FLASH_WORD_WRITE_TIME;
    this.DFU_PACKET_MAX_SIZE = 512;
    this.ACK_PACKET_TIMEOUT = 1000;
    
    this.init();
  }
  
  init() {
    if (!this.button) {
      throw new Error('Button element is required');
    }
    
    this.button.addEventListener('click', () => this.startInstall());
    // Modal will be created on first use
  }
  
  createModal() {
    // Check if modal already exists
    if (document.getElementById('nrf52-dfu-modal')) {
      this.modal = document.getElementById('nrf52-dfu-modal');
      return;
    }
    
    const modal = document.createElement('div');
    modal.id = 'nrf52-dfu-modal';
    modal.className = 'nrf52-dfu-modal';
    modal.innerHTML = `
      <div class="nrf52-dfu-modal-content">
        <button class="nrf52-dfu-close" id="nrf52-dfu-close-btn" aria-label="Close">&times;</button>
        <div class="nrf52-dfu-headline" id="nrf52-dfu-headline"></div>
        <div class="nrf52-dfu-content" id="nrf52-dfu-content"></div>
        <div class="nrf52-dfu-actions" id="nrf52-dfu-actions"></div>
      </div>
    `;
    
    document.body.appendChild(modal);
    this.modal = modal;
    
    // Close button handlers - use event delegation to ensure it always works
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeModal();
      } else if (e.target.closest('.nrf52-dfu-close') || e.target.closest('#nrf52-dfu-close-btn')) {
        e.preventDefault();
        e.stopPropagation();
        this.closeModal();
      }
    });
    
    // Inject styles if not already present
    this.injectStyles();
    
    // Show welcome page initially
    this.renderPage('WELCOME');
  }
  
  renderPage(state, data = {}) {
    this.currentState = state;
    const headlineEl = document.getElementById('nrf52-dfu-headline');
    const contentEl = document.getElementById('nrf52-dfu-content');
    const actionsEl = document.getElementById('nrf52-dfu-actions');
    const closeBtn = document.getElementById('nrf52-dfu-close-btn');
    
    if (!headlineEl || !contentEl || !actionsEl) return;
    
    // Show/hide close button based on state
    if (closeBtn) {
      const shouldHide = (state === 'INSTALLING' || state === 'WAITING_CONTINUE' || state === 'WAITING_RECONNECT');
      closeBtn.style.display = shouldHide ? 'none' : 'block';
      // Ensure button is clickable when visible
      if (!shouldHide) {
        closeBtn.style.pointerEvents = 'auto';
        closeBtn.style.zIndex = '1000';
      }
    }
    
    headlineEl.innerHTML = '';
    contentEl.innerHTML = '';
    actionsEl.innerHTML = '';
    
    switch (state) {
      case 'WELCOME':
        this.renderWelcomePage(headlineEl, contentEl, actionsEl);
        break;
      case 'LOADING':
        this.renderLoadingPage(headlineEl, contentEl, actionsEl, data);
        break;
      case 'INSTALLING':
        this.renderInstallingPage(headlineEl, contentEl, actionsEl, data);
        break;
      case 'WAITING_CONTINUE':
        this.renderWaitingContinuePage(headlineEl, contentEl, actionsEl, data);
        break;
      case 'WAITING_RECONNECT':
        this.renderWaitingReconnectPage(headlineEl, contentEl, actionsEl, data);
        break;
      case 'SUCCESS':
        this.renderSuccessPage(headlineEl, contentEl, actionsEl, data);
        break;
      case 'ERROR':
        this.renderErrorPage(headlineEl, contentEl, actionsEl, data);
        break;
    }
  }
  
  renderWelcomePage(headline, content, actions) {
    headline.innerHTML = '<h3>nRF Web Tool</h3>';
    content.innerHTML = `
      <div class="nrf52-dfu-welcome">
        <div class="nrf52-dfu-welcome-icon">📱</div>
        <p>This tool will help you update the firmware on your nRF52 device using nRF Web Tool.</p>
        <div class="nrf52-dfu-instructions">
          <h4>How it works:</h4>
          <ol>
            <li>Click "Start Update" below</li>
            <li><strong>Select your device twice:</strong>
              <ul>
                <li>First time: for reset (1200 baud) - device will enter DFU mode</li>
                <li>Second time: for flashing (115200 baud) - firmware will be installed</li>
              </ul>
            </li>
            <li>Wait for the update to complete</li>
          </ol>
          <p class="nrf52-dfu-note"><strong>Note:</strong> The browser will prompt you to select your device twice. This is normal and required for the update process.</p>
        </div>
      </div>
    `;
    actions.innerHTML = `
      <button class="nrf52-dfu-btn nrf52-dfu-btn-primary" id="nrf52-dfu-start-btn">Start Update</button>
    `;
    const startBtn = document.getElementById('nrf52-dfu-start-btn');
    if (startBtn) {
      startBtn.onclick = () => this.startInstall();
    }
  }
  
  renderLoadingPage(headline, content, actions, data) {
    headline.innerHTML = '<h3>Loading Package</h3>';
    content.innerHTML = `
      <div class="nrf52-dfu-progress-page">
        <div class="nrf52-dfu-spinner"></div>
        <p>${data.message || 'Loading firmware package...'}</p>
      </div>
    `;
    actions.innerHTML = '';
  }
  
  renderInstallingPage(headline, content, actions, data) {
    headline.innerHTML = '<h3>Installing</h3>';
    const progress = data.progress || 0;
    const label = data.label || 'Installing firmware...';
    const showProgress = progress > 0 && progress < 100;
    
    content.innerHTML = `
      <div class="nrf52-dfu-progress-page">
        ${showProgress ? `
          <div class="nrf52-dfu-circular-progress">
            <svg class="nrf52-dfu-circular-progress-svg" viewBox="0 0 48 48">
              <circle class="nrf52-dfu-circular-progress-track" cx="24" cy="24" r="20" fill="none" stroke-width="4"/>
              <circle class="nrf52-dfu-circular-progress-fill" cx="24" cy="24" r="20" fill="none" stroke-width="4" 
                      stroke-dasharray="${2 * Math.PI * 20}" 
                      stroke-dashoffset="${2 * Math.PI * 20 * (1 - progress / 100)}"/>
            </svg>
          </div>
        ` : `
          <div class="nrf52-dfu-spinner"></div>
        `}
        <p>${label}</p>
        ${data.details ? `<p class="nrf52-dfu-details">${data.details}</p>` : ''}
        <div class="nrf52-dfu-log" id="nrf52-dfu-log" style="display: none;"></div>
      </div>
    `;
    actions.innerHTML = '';
  }
  
  renderSuccessPage(headline, content, actions, data) {
    headline.innerHTML = '<h3>Installation Complete</h3>';
    content.innerHTML = `
      <div class="nrf52-dfu-message-page">
        <div class="nrf52-dfu-message-icon">🎉</div>
        <p>${data.message || 'Firmware has been successfully installed on your device!'}</p>
      </div>
    `;
    actions.innerHTML = `
      <button class="nrf52-dfu-btn nrf52-dfu-btn-primary" onclick="document.getElementById('nrf52-dfu-modal').querySelector('#nrf52-dfu-close-btn').click()">Close</button>
    `;
  }
  
  renderWaitingContinuePage(headline, content, actions, data) {
    headline.innerHTML = '<h3>Device Reset</h3>';
    content.innerHTML = `
      <div class="nrf52-dfu-message-page">
        <div class="nrf52-dfu-message-icon">✓</div>
        <p>${data.message || 'Device has been reset and is now in DFU mode.'}</p>
        <p class="nrf52-dfu-details">Click "Continue" below to proceed with firmware installation. You will be prompted to select your device again.</p>
      </div>
    `;
    actions.innerHTML = `
      <button class="nrf52-dfu-btn nrf52-dfu-btn-primary" id="nrf52-dfu-continue-btn">Continue</button>
    `;
    const continueBtn = document.getElementById('nrf52-dfu-continue-btn');
    if (continueBtn) {
      continueBtn.onclick = () => this.continueFlash();
    }
  }
  
  renderWaitingReconnectPage(headline, content, actions, data) {
    headline.innerHTML = '<h3>Reconnect Device</h3>';
    content.innerHTML = `
      <div class="nrf52-dfu-message-page">
        <div class="nrf52-dfu-message-icon">🔄</div>
        <p>${data.message || 'Device needs to be reconnected for the next firmware part.'}</p>
        <p class="nrf52-dfu-details">${data.details || 'Click "Reconnect" below to select your device again. You will be prompted to select your device.'}</p>
      </div>
    `;
    actions.innerHTML = `
      <button class="nrf52-dfu-btn nrf52-dfu-btn-primary" id="nrf52-dfu-reconnect-btn">Reconnect</button>
      <button class="nrf52-dfu-btn nrf52-dfu-btn-secondary" id="nrf52-dfu-reset-again-btn">Reset Again</button>
    `;
    const reconnectBtn = document.getElementById('nrf52-dfu-reconnect-btn');
    const resetAgainBtn = document.getElementById('nrf52-dfu-reset-again-btn');
    if (reconnectBtn) {
      reconnectBtn.onclick = () => this.reconnectAndContinue();
    }
    if (resetAgainBtn) {
      resetAgainBtn.onclick = () => this.resetAndReconnect();
    }
  }
  
  renderErrorPage(headline, content, actions, data) {
    headline.innerHTML = '<h3>Error</h3>';
    content.innerHTML = `
      <div class="nrf52-dfu-message-page">
        <div class="nrf52-dfu-message-icon">⚠️</div>
        <p>${data.message || 'An error occurred during the update process.'}</p>
        ${data.details ? `<p class="nrf52-dfu-error-details">${data.details}</p>` : ''}
      </div>
    `;
    actions.innerHTML = `
      <button class="nrf52-dfu-btn nrf52-dfu-btn-secondary" onclick="document.getElementById('nrf52-dfu-modal').querySelector('#nrf52-dfu-close-btn').click()">Close</button>
      ${data.retry ? `<button class="nrf52-dfu-btn nrf52-dfu-btn-primary" id="nrf52-dfu-retry-btn">Retry</button>` : ''}
      ${data.retryFromReconnect ? `<button class="nrf52-dfu-btn nrf52-dfu-btn-primary" id="nrf52-dfu-retry-reconnect-btn">Retry Reconnect</button>` : ''}
    `;
    if (data.retry) {
      const retryBtn = document.getElementById('nrf52-dfu-retry-btn');
      if (retryBtn) {
        retryBtn.onclick = () => {
          if (data.retryFromReconnect && this.flashState) {
            // Continue from reconnection step
            this.reconnectAndContinue();
          } else {
            // Start from beginning
            this.startInstall();
          }
        };
      }
    }
    if (data.retryFromReconnect) {
      const retryReconnectBtn = document.getElementById('nrf52-dfu-retry-reconnect-btn');
      if (retryReconnectBtn) {
        retryReconnectBtn.onclick = () => this.reconnectAndContinue();
      }
    }
  }
  
  injectStyles() {
    if (document.getElementById('nrf52-dfu-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'nrf52-dfu-styles';
    style.textContent = `
      .nrf52-dfu-modal {
        display: none;
        position: fixed;
        z-index: 10000;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      }
      .nrf52-dfu-modal.show {
        display: flex;
      }
      .nrf52-dfu-modal-content {
        background: var(--card-background, #1e1e1e);
        border: 1px solid var(--border-color, #333);
        border-radius: 12px;
        padding: 0;
        max-width: 390px;
        width: 90%;
        max-height: 80vh;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
        display: flex;
        flex-direction: column;
        color: var(--foreground, #e0e0e0);
        position: relative;
        overflow: hidden;
      }
      .nrf52-dfu-headline {
        padding: 24px 24px 0 24px;
        position: relative;
      }
      .nrf52-dfu-headline h3 {
        margin: 0;
        padding-right: 48px;
        color: var(--foreground, #e0e0e0);
        font-size: 1.5rem;
        font-weight: 400;
      }
      .nrf52-dfu-close {
        position: absolute;
        right: 8px;
        top: 8px;
        z-index: 1000;
        color: var(--muted-foreground, #8b949e);
        font-size: 24px;
        font-weight: bold;
        cursor: pointer;
        line-height: 1;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        padding: 0;
        pointer-events: auto;
      }
      .nrf52-dfu-close:hover {
        color: var(--foreground, #e0e0e0);
      }
      .nrf52-dfu-content {
        padding: 24px;
        flex: 1;
        overflow-y: auto;
      }
      .nrf52-dfu-actions {
        padding: 0 24px 24px 24px;
        display: flex;
        gap: 12px;
      }
      .nrf52-dfu-welcome {
        text-align: center;
      }
      .nrf52-dfu-welcome-icon {
        font-size: 64px;
        margin-bottom: 16px;
      }
      .nrf52-dfu-welcome p {
        margin: 16px 0;
        line-height: 1.6;
        color: var(--foreground, #e0e0e0);
      }
      .nrf52-dfu-instructions {
        text-align: left;
        margin-top: 24px;
        background: var(--card-background, #2a2a2a);
        border: 1px solid var(--border-color, #333);
        border-radius: 8px;
        padding: 16px;
      }
      .nrf52-dfu-instructions h4 {
        margin: 0 0 12px 0;
        font-size: 1rem;
        color: var(--foreground, #e0e0e0);
      }
      .nrf52-dfu-instructions ol {
        margin: 0;
        padding-left: 20px;
        line-height: 1.8;
      }
      .nrf52-dfu-instructions ul {
        margin: 8px 0;
        padding-left: 20px;
        line-height: 1.6;
      }
      .nrf52-dfu-instructions li {
        margin: 8px 0;
        color: var(--muted-foreground, #a0a0a0);
      }
      .nrf52-dfu-note {
        margin-top: 16px;
        padding: 12px;
        background: rgba(0, 191, 255, 0.1);
        border-left: 3px solid var(--accent, #00bfff);
        border-radius: 4px;
        font-size: 0.9rem;
      }
      .nrf52-dfu-progress-page {
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .nrf52-dfu-spinner {
        width: 48px;
        height: 48px;
        border: 4px solid var(--border-color, #333);
        border-top-color: var(--accent, #00bfff);
        border-radius: 50%;
        animation: nrf52-dfu-spin 1s linear infinite;
        margin-bottom: 16px;
      }
      @keyframes nrf52-dfu-spin {
        to { transform: rotate(360deg); }
      }
      .nrf52-dfu-progress-page p {
        margin: 8px 0;
        line-height: 1.6;
      }
      .nrf52-dfu-details {
        font-size: 0.9rem;
        color: var(--muted-foreground, #a0a0a0);
        margin-top: 8px;
      }
      .nrf52-dfu-message-page {
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .nrf52-dfu-message-icon {
        font-size: 64px;
        margin-bottom: 16px;
      }
      .nrf52-dfu-message-page p {
        margin: 8px 0;
        line-height: 1.6;
      }
      .nrf52-dfu-error-details {
        margin-top: 16px;
        padding: 12px;
        background: rgba(248, 81, 73, 0.1);
        border-left: 3px solid #f85149;
        border-radius: 4px;
        font-size: 0.9rem;
        text-align: left;
        color: #f85149;
      }
      .nrf52-dfu-circular-progress {
        position: relative;
        width: 48px;
        height: 48px;
        margin: 0 auto 16px;
      }
      .nrf52-dfu-circular-progress-svg {
        width: 100%;
        height: 100%;
        transform: rotate(-90deg);
      }
      .nrf52-dfu-circular-progress-track {
        stroke: var(--border-color, #333);
      }
      .nrf52-dfu-circular-progress-fill {
        stroke: var(--accent, #00bfff);
        stroke-linecap: round;
        transition: stroke-dashoffset 0.3s ease;
      }
      .nrf52-dfu-circular-progress .nrf52-dfu-progress-text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 14px;
        color: var(--foreground, #e0e0e0);
        font-weight: 500;
        margin: 0;
      }
      .nrf52-dfu-progress-text {
        font-size: 16px;
        color: var(--foreground, #e0e0e0);
        font-weight: 500;
        margin-bottom: 16px;
      }
      .nrf52-dfu-log {
        display: none !important;
        visibility: hidden;
        max-height: 0;
        overflow: hidden;
      }
      .nrf52-dfu-log-entry {
        margin-bottom: 2px;
        line-height: 1.4;
      }
      .nrf52-dfu-log-entry.error {
        color: #f85149;
      }
      .nrf52-dfu-log-entry.success {
        color: #3fb950;
      }
      .nrf52-dfu-log-entry.info {
        color: #58a6ff;
      }
      .nrf52-dfu-actions {
        display: flex;
        gap: 12px;
        margin-top: 20px;
      }
      .nrf52-dfu-btn {
        flex: 1;
        padding: 12px 24px;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      .nrf52-dfu-btn-primary {
        background: var(--accent, #00bfff);
        color: var(--accent-button, #fff);
      }
      .nrf52-dfu-btn-primary:hover {
        background: var(--accent-hover, #0099cc);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 191, 255, 0.3);
      }
      .nrf52-dfu-btn-secondary {
        background: var(--card-background, #2a2a2a);
        color: var(--foreground, #e0e0e0);
        border: 1px solid var(--border-color, #333);
      }
      .nrf52-dfu-btn-secondary:hover {
        background: var(--card-background, #333);
        border-color: var(--accent, #00bfff);
      }
      .nrf52-dfu-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
    `;
    document.head.appendChild(style);
  }
  
  showModal() {
    if (this.modal) {
      this.modal.classList.add('show');
    }
  }
  
  closeModal() {
    if (this.modal) {
      this.modal.classList.remove('show');
    }
  }
  
  log(message, type = 'info') {
    const logEl = document.getElementById('nrf52-dfu-log');
    if (!logEl) return;
    
    const entry = document.createElement('div');
    entry.className = `nrf52-dfu-log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
    
    // Keep only last 50 entries
    while (logEl.children.length > 50) {
      logEl.removeChild(logEl.firstChild);
    }
  }
  
  updateProgress(percent, label = '', details = '') {
    if (this.currentState === 'INSTALLING') {
      this.renderPage('INSTALLING', {
        progress: percent,
        label: label || 'Installing firmware...',
        details: details
      });
    }
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // SLIP encoding
  slipEncode(data) {
    let out = [];
    for (let b of data) {
      if (b === this.SLIP_END) out.push(this.SLIP_ESC, this.SLIP_ESC_END);
      else if (b === this.SLIP_ESC) out.push(this.SLIP_ESC, this.SLIP_ESC_ESC);
      else out.push(b);
    }
    return new Uint8Array(out);
  }
  
  slipDecodeEscChars(data) {
    let result = [];
    let i = 0;
    while (i < data.length) {
      if (data[i] === 0xDB) {
        i++;
        if (i >= data.length) throw new Error('Invalid SLIP escape sequence');
        if (data[i] === 0xDC) result.push(0xC0);
        else if (data[i] === 0xDD) result.push(0xDB);
        else throw new Error('Char 0xDB NOT followed by 0xDC or 0xDD');
      } else {
        result.push(data[i]);
      }
      i++;
    }
    return new Uint8Array(result);
  }
  
  // CRC16 Nordic variant
  crc16Nordic(data) {
    let crc = 0xFFFF;
    for (let b of data) {
      crc = (crc >> 8 & 0x00FF) | (crc << 8 & 0xFF00);
      crc ^= b;
      crc ^= (crc & 0x00FF) >> 4;
      crc ^= (crc << 8) << 4;
      crc ^= ((crc & 0x00FF) << 4) << 1;
    }
    return crc & 0xFFFF;
  }
  
  // HCI Packet functions
  slipPartsToFourBytes(seq, dip, rp, pktType, pktLen) {
    let bytes = new Uint8Array(4);
    bytes[0] = seq | (((seq + 1) % 8) << 3) | (dip << 6) | (rp << 7);
    bytes[1] = pktType | ((pktLen & 0x000F) << 4);
    bytes[2] = (pktLen & 0x0FF0) >> 4;
    bytes[3] = (~(bytes[0] + bytes[1] + bytes[2]) + 1) & 0xFF;
    return bytes;
  }
  
  int32ToBytes(value) {
    return new Uint8Array([
      value & 0xFF,
      (value >> 8) & 0xFF,
      (value >> 16) & 0xFF,
      (value >> 24) & 0xFF
    ]);
  }
  
  int16ToBytes(value) {
    return new Uint8Array([
      value & 0xFF,
      (value >> 8) & 0xFF
    ]);
  }
  
  createHciPacket(data) {
    this.hciSequenceNumber = (this.hciSequenceNumber + 1) % 8;
    
    let header = this.slipPartsToFourBytes(
      this.hciSequenceNumber,
      this.DATA_INTEGRITY_CHECK_PRESENT,
      this.RELIABLE_PACKET,
      this.HCI_PACKET_TYPE,
      data.length
    );
    
    let tempData = new Uint8Array(header.length + data.length);
    tempData.set(header);
    tempData.set(data, header.length);
    
    let crc = this.crc16Nordic(tempData);
    let crcBytes = new Uint8Array([crc & 0xFF, (crc >> 8) & 0xFF]);
    
    let packetData = new Uint8Array(tempData.length + crcBytes.length);
    packetData.set(tempData);
    packetData.set(crcBytes, tempData.length);
    
    let encoded = this.slipEncode(packetData);
    let finalPacket = new Uint8Array(1 + encoded.length + 1);
    finalPacket[0] = this.SLIP_END;
    finalPacket.set(encoded, 1);
    finalPacket[finalPacket.length - 1] = this.SLIP_END;
    
    return finalPacket;
  }
  
  concatArrays(a, b) {
    let result = new Uint8Array(a.length + b.length);
    result.set(a);
    result.set(b, a.length);
    return result;
  }
  
  // DFU Transport functions
  async readLoop() {
    while (true) {
      try {
        const { value, done } = await this.reader.read();
        if (done) break;
        
        for (let b of value) {
          if (b === this.SLIP_END) {
            if (this.rxBuf.length >= 2) {
              try {
                let decoded = this.slipDecodeEscChars(new Uint8Array(this.rxBuf));
                if (decoded.length >= 2) {
                  let ackNr = (decoded[0] >> 3) & 0x07;
                  if (this.resolveAck) {
                    clearTimeout(this.ackTimeout);
                    this.resolveAck(ackNr);
                    this.resolveAck = null;
                  }
                }
              } catch (err) {
                // Invalid packet, ignore
              }
            }
            this.rxBuf = [];
          } else {
            this.rxBuf.push(b);
          }
        }
      } catch (e) {
        this.log("Read error: " + e, 'error');
        break;
      }
    }
  }
  
  waitForAck(timeout = this.ACK_PACKET_TIMEOUT) {
    return new Promise((resolve, reject) => {
      this.resolveAck = resolve;
      this.ackTimeout = setTimeout(() => {
        this.resolveAck = null;
        this.hciSequenceNumber = 0;
        reject(new Error("ACK timeout"));
      }, timeout);
    });
  }
  
  async sendPacket(pkt) {
    let attempts = 0;
    let lastAck = null;
    let packetSent = false;
    
    while (!packetSent) {
      await this.writer.write(pkt);
      attempts++;
      
      try {
        let ack = await this.waitForAck();
        if (lastAck === null) {
          lastAck = ack;
          packetSent = true;
        } else if (ack === (lastAck + 1) % 8) {
          lastAck = ack;
          packetSent = true;
        } else {
          if (attempts > 3) {
            throw new Error("Three failed tx attempts encountered");
          }
        }
      } catch (e) {
        if (attempts > 3) {
          throw new Error("Failed to get ACK: " + e);
        }
      }
    }
  }
  
  getEraseWaitTime(totalSize) {
    return Math.max(500, ((Math.floor(totalSize / this.FLASH_PAGE_SIZE) + 1) * this.FLASH_PAGE_ERASE_TIME * 1000));
  }
  
  getActivateWaitTime(totalSize, sdSize, singleBank) {
    if (singleBank && sdSize === 0) {
      return (this.FLASH_PAGE_ERASE_TIME + this.FLASH_PAGE_WRITE_TIME) * 1000;
    } else {
      let writeWaitTime = ((Math.floor(totalSize / this.FLASH_PAGE_SIZE) + 1) * this.FLASH_PAGE_WRITE_TIME * 1000);
      return this.getEraseWaitTime(totalSize) + writeWaitTime;
    }
  }
  
  async sendStartDfu(mode, softdeviceSize, bootloaderSize, appSize) {
    let frame = this.int32ToBytes(this.DFU_START_PACKET);
    frame = this.concatArrays(frame, this.int32ToBytes(mode));
    
    let sizes = new Uint8Array(12);
    let offset = 0;
    if (softdeviceSize !== undefined && softdeviceSize !== null) {
      sizes.set(this.int32ToBytes(softdeviceSize), offset);
      offset += 4;
    } else {
      sizes.set(this.int32ToBytes(0), offset);
      offset += 4;
    }
    if (bootloaderSize !== undefined && bootloaderSize !== null) {
      sizes.set(this.int32ToBytes(bootloaderSize), offset);
      offset += 4;
    } else {
      sizes.set(this.int32ToBytes(0), offset);
      offset += 4;
    }
    if (appSize !== undefined && appSize !== null) {
      sizes.set(this.int32ToBytes(appSize), offset);
    } else {
      sizes.set(this.int32ToBytes(0), offset);
    }
    
    frame = this.concatArrays(frame, sizes);
    let packet = this.createHciPacket(frame);
    await this.sendPacket(packet);
    
    let totalSize = (softdeviceSize || 0) + (bootloaderSize || 0) + (appSize || 0);
    await this.sleep(this.getEraseWaitTime(totalSize));
  }
  
  async sendInitPacket(initPacket) {
    let frame = this.int32ToBytes(this.DFU_INIT_PACKET);
    frame = this.concatArrays(frame, new Uint8Array(initPacket));
    frame = this.concatArrays(frame, this.int16ToBytes(0x0000)); // Padding
    
    let packet = this.createHciPacket(frame);
    await this.sendPacket(packet);
  }
  
  async sendFirmware(firmware, onProgress) {
    let frames = [];
    
    for (let i = 0; i < firmware.length; i += this.DFU_PACKET_MAX_SIZE) {
      let frame = this.int32ToBytes(this.DFU_DATA_PACKET);
      let chunk = firmware.slice(i, i + this.DFU_PACKET_MAX_SIZE);
      frame = this.concatArrays(frame, chunk);
      frames.push(frame);
    }
    
    for (let count = 0; count < frames.length; count++) {
      let packet = this.createHciPacket(frames[count]);
      await this.sendPacket(packet);
      
      if (onProgress) {
        let percent = Math.floor((count / frames.length) * 100);
        onProgress(percent);
      }
      
      if (count % 8 === 0 && count > 0) {
        await this.sleep(this.FLASH_PAGE_WRITE_TIME * 1000);
      }
    }
    
    await this.sleep(this.FLASH_PAGE_WRITE_TIME * 1000);
    
    let stopFrame = this.int32ToBytes(this.DFU_STOP_DATA_PACKET);
    let stopPacket = this.createHciPacket(stopFrame);
    await this.sendPacket(stopPacket);
    
    if (onProgress) onProgress(100);
  }
  
  async disconnectPort() {
    if (this.port) {
      try {
        if (this.reader) {
          await this.reader.cancel();
          this.reader.releaseLock();
          this.reader = null;
        }
        if (this.writer) {
          await this.writer.close();
          this.writer.releaseLock();
          this.writer = null;
        }
        if (this.port.readable) this.port.readable.releaseLock();
        if (this.port.writable) this.port.writable.releaseLock();
        await this.port.close();
        this.port = null;
      } catch (closeErr) {
        // Ignore close errors
      }
    }
  }
  
  async loadPackage(zipPath) {
    try {
      // Check if JSZip is available
      if (typeof JSZip === 'undefined') {
        throw new Error('JSZip library is required. Please include: <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>');
      }
      
      this.log(`Loading DFU package from: ${zipPath}...`, 'info');
      
      // Load ZIP file (can be URL or File object)
      let zip;
      if (typeof zipPath === 'string') {
        // URL
        const response = await fetch(zipPath);
        if (!response.ok) {
          throw new Error(`Failed to fetch package: ${response.statusText}`);
        }
        const blob = await response.blob();
        zip = await JSZip.loadAsync(blob);
      } else if (zipPath instanceof File) {
        // File object
        zip = await JSZip.loadAsync(zipPath);
      } else {
        throw new Error('Invalid zipPath: must be URL string or File object');
      }
      
      // Check for manifest.json
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) {
        throw new Error("manifest.json not found in package");
      }
      
      // Parse manifest
      const manifestText = await manifestFile.async('string');
      const manifestData = JSON.parse(manifestText);
      const manifest = manifestData.manifest;
      
      if (!manifest) {
        throw new Error("Invalid manifest structure");
      }
      
      this.log(`DFU version: ${manifest.dfu_version || 'unknown'}`, 'info');
      
      // Load all available firmware types in the correct order
      this.firmwareQueue = [];
      
      const firmwareOrder = [
        { key: 'softdevice_bootloader', type: 'softdevice+bootloader', mode: this.DFU_UPDATE_MODE_SD_BL },
        { key: 'softdevice', type: 'softdevice', mode: this.DFU_UPDATE_MODE_SD },
        { key: 'bootloader', type: 'bootloader', mode: this.DFU_UPDATE_MODE_BL },
        { key: 'application', type: 'application', mode: this.DFU_UPDATE_MODE_APP }
      ];
      
      for (const fw of firmwareOrder) {
        if (manifest[fw.key]) {
          const firmwareInfo = manifest[fw.key];
          this.log(`Found ${fw.type} firmware`, 'info');
          this.log(`  Binary: ${firmwareInfo.bin_file}`, 'info');
          this.log(`  Init packet: ${firmwareInfo.dat_file}`, 'info');
          
          const binFile = zip.file(firmwareInfo.bin_file);
          if (!binFile) {
            throw new Error(`Binary file not found: ${firmwareInfo.bin_file}`);
          }
          const fwBin = new Uint8Array(await binFile.async('arraybuffer'));
          this.log(`  Loaded firmware: ${fwBin.length} bytes`, 'info');
          
          const datFile = zip.file(firmwareInfo.dat_file);
          if (!datFile) {
            throw new Error(`Init packet file not found: ${firmwareInfo.dat_file}`);
          }
          const initBin = new Uint8Array(await datFile.async('arraybuffer'));
          this.log(`  Loaded init packet: ${initBin.length} bytes`, 'info');
          
          this.firmwareQueue.push({
            type: fw.type,
            mode: fw.mode,
            bin: fwBin,
            dat: initBin,
            info: firmwareInfo
          });
        }
      }
      
      if (this.firmwareQueue.length === 0) {
        throw new Error("No firmware found in package");
      }
      
      this.log(`✓ Package loaded successfully - ${this.firmwareQueue.length} firmware type(s) ready`, 'success');
      return true;
    } catch (err) {
      this.log("✗ Error loading package: " + err.message, 'error');
      throw err;
    }
  }
  
  async flashSingleFirmware(fw, progressBase, progressRange) {
    let dfuMode = fw.mode;
    let appSize = 0;
    let softdeviceSize = 0;
    let bootloaderSize = 0;
    let firmwareSize = fw.bin.length;
    
    if (fw.type === "application") {
      appSize = firmwareSize;
    } else if (fw.type === "bootloader") {
      bootloaderSize = firmwareSize;
    } else if (fw.type === "softdevice") {
      softdeviceSize = firmwareSize;
    } else if (fw.type === "softdevice+bootloader") {
      softdeviceSize = fw.info.sd_size || 0;
      bootloaderSize = fw.info.bl_size || 0;
      if (softdeviceSize === 0 || bootloaderSize === 0) {
        throw new Error("SD+BL package missing sd_size or bl_size in manifest");
      }
      if (softdeviceSize + bootloaderSize !== firmwareSize) {
        throw new Error(`SD+BL size mismatch: ${softdeviceSize} + ${bootloaderSize} != ${firmwareSize}`);
      }
    }
    
    this.log(`\nFlashing ${fw.type}...`, 'info');
    this.log(`  Size: ${firmwareSize} bytes`, 'info');
    
    await this.sendStartDfu(dfuMode, softdeviceSize, bootloaderSize, appSize);
    this.log("  Start packet sent", 'info');
    
    await this.sendInitPacket(fw.dat);
    this.log("  Init packet sent", 'info');
    
    this.log("  Sending firmware...", 'info');
    await this.sendFirmware(fw.bin, (percent) => {
      const overallPercent = progressBase + (percent * progressRange / 100);
      this.updateProgress(overallPercent, `Installing ${fw.type}...`, `${Math.round(percent)}% complete`);
      if (percent % 10 === 0) {
        this.log(`  Progress: ${percent}%`, 'info');
      }
    });
    
    this.log("  Firmware sent, activating...", 'info');
    await this.sleep(this.getActivateWaitTime(firmwareSize, softdeviceSize, false));
    
    this.log(`  ✓ ${fw.type} flashed successfully`, 'success');
  }
  
  async startInstall() {
    // Check for Web Serial API support (native or via polyfill)
    if (!navigator.serial) {
      // Check if WebUSB is available (for Android via polyfill)
      const hasWebUSB = navigator.usb !== undefined;
      this.renderPage('ERROR', {
        message: 'Web Serial API is not supported',
        details: hasWebUSB 
          ? 'Web Serial API is not available. If you are on Android, make sure to include the web-serial-polyfill script before this library. Otherwise, please use Google Chrome or Microsoft Edge on desktop.'
          : 'Please use Google Chrome or Microsoft Edge to use this tool. For Android support, include the web-serial-polyfill library.'
      });
      return;
    }
    
    if (!this.zipPath) {
      this.renderPage('ERROR', {
        message: 'No package specified',
        details: 'Please provide a valid DFU package path.'
      });
      return;
    }
    
    // Create modal if it doesn't exist
    if (!this.modal) {
      this.createModal();
    }
    
    this.showModal();
    
    // Clear log
    const logEl = document.getElementById('nrf52-dfu-log');
    if (logEl) logEl.innerHTML = '';
    
    try {
      // Load package
      this.renderPage('LOADING', { message: 'Loading firmware package...' });
      await this.loadPackage(this.zipPath);
      
      // Start flashing immediately after loading
      await this.performFlash();
      
    } catch (err) {
      this.renderPage('ERROR', {
        message: 'Failed to load package',
        details: err.message,
        retry: true
      });
    }
  }
  
  async performFlash() {
    try {
      // Step 1: Reset device (1200 baud)
      this.renderPage('INSTALLING', {
        progress: 0,
        label: 'Resetting device',
        details: 'Please select your device (first time)'
      });
      this.log("=== Step 1: Resetting device ===", 'info');
      this.log("Please select your device (first time)...", 'info');
      
      await this.disconnectPort();
      
      try {
        const resetPort = await navigator.serial.requestPort();
        await resetPort.open({ baudRate: 1200 });
        await resetPort.close();
        this.log("✓ Reset triggered - device entering DFU mode", 'success');
        await this.sleep(500);
        
        // Show continue button - this ensures the next requestPort() call is in a user gesture context
        this.renderPage('WAITING_CONTINUE', {
          message: 'Device reset successful!'
        });
        
        // Store state so continueFlash can access it
        this.flashState = { 
          firmwareQueue: this.firmwareQueue,
          currentFirmwareIndex: 0
        };
        this.currentFirmwareIndex = 0;
      } catch (portError) {
        // Check if user cancelled the port selection
        if (portError instanceof DOMException && portError.name === 'NotFoundError') {
          this.renderPage('ERROR', {
            message: 'Port selection cancelled',
            details: 'You can also press the reset button on your device twice quickly to force it into bootloader mode, then click "Retry" to continue.',
            retry: true
          });
          return;
        }
        // Re-throw other errors to be caught by outer catch
        throw portError;
      }
      
    } catch (e) {
      this.log("DFU error: " + e, 'error');
      await this.disconnectPort();
      
      this.renderPage('ERROR', {
        message: 'Installation failed',
        details: e.message,
        retry: true
      });
    }
  }
  
  async continueFlash() {
    try {
      // Restore state if available
      if (this.flashState) {
        this.firmwareQueue = this.flashState.firmwareQueue;
        this.currentFirmwareIndex = this.flashState.currentFirmwareIndex || 0;
      }
      
      // Step 2: Flash firmware (115200 baud)
      // This is now called from a button click, so we're in a user gesture context
      this.renderPage('INSTALLING', {
        progress: 0,
        label: 'Connecting to device',
        details: 'Please select your device again (second time)'
      });
      this.log("=== Step 2: Flashing firmware ===", 'info');
      this.log(`Flashing ${this.firmwareQueue.length} firmware type(s)...`, 'info');
      this.log("Please select your device again (second time)...", 'info');
      
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });
      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this.rxBuf = [];
      this.hciSequenceNumber = 0;
      this.readLoop();
      await this.sleep(100);
      
      this.log("Starting DFU...", 'info');
      this.updateProgress(0, 'Preparing installation');
      
      // Flash each firmware type in order, starting from current index
      await this.flashRemainingFirmware();
      
    } catch (e) {
      this.log("DFU error: " + e, 'error');
      await this.disconnectPort();
      
      // Check if this is a connection error and we have more firmware to flash
      const isConnectionError = e.message && (
        e.message.includes('Failed to get ACK') || 
        e.message.includes('ACK timeout') ||
        e.message.includes('NotFoundError')
      );
      
      if (isConnectionError && this.currentFirmwareIndex < this.firmwareQueue.length) {
        // Connection lost, need to reconnect
        this.flashState = {
          firmwareQueue: this.firmwareQueue,
          currentFirmwareIndex: this.currentFirmwareIndex
        };
        this.renderPage('WAITING_RECONNECT', {
          message: 'Connection lost. Device may have reset after flashing.',
          details: `Need to reconnect to continue flashing remaining firmware (${this.firmwareQueue.length - this.currentFirmwareIndex} part(s) remaining).`
        });
      } else {
        this.renderPage('ERROR', {
          message: 'Installation failed',
          details: e.message,
          retry: true,
          retryFromReconnect: (this.currentFirmwareIndex > 0 && this.currentFirmwareIndex < this.firmwareQueue.length)
        });
      }
    }
  }
  
  async flashRemainingFirmware() {
    // Flash each firmware type in order, starting from current index
    for (let i = this.currentFirmwareIndex; i < this.firmwareQueue.length; i++) {
      const fw = this.firmwareQueue[i];
      this.currentFirmwareIndex = i;
      
      // Update flash state
      if (this.flashState) {
        this.flashState.currentFirmwareIndex = i;
      }
      
      const progressBase = (i / this.firmwareQueue.length) * 100;
      const progressRange = 100 / this.firmwareQueue.length;
      
      this.updateProgress(progressBase, `Installing ${fw.type}...`);
      
      await this.flashSingleFirmware(fw, progressBase, progressRange);
      
      // Check if this firmware type might cause a reset and if there's more to flash
      const mightReset = fw.type === 'softdevice+bootloader' || fw.type === 'softdevice' || fw.type === 'bootloader';
      const hasMoreFirmware = (i + 1) < this.firmwareQueue.length;
      
      if (mightReset && hasMoreFirmware) {
        // Device likely reset, need to reconnect for next firmware
        this.log(`\n${fw.type} flashed. Device may have reset. Need to reconnect for next firmware part.`, 'info');
        await this.disconnectPort();
        
        // Update state
        this.currentFirmwareIndex = i + 1;
        this.flashState = {
          firmwareQueue: this.firmwareQueue,
          currentFirmwareIndex: i + 1
        };
        
        // Prompt user to reconnect
        this.renderPage('WAITING_RECONNECT', {
          message: `${fw.type} installed successfully!`,
          details: `Device needs to be reconnected to continue with the next firmware part (${this.firmwareQueue.length - i - 1} remaining). Click "Reconnect" to continue.`
        });
        return; // Exit, will continue when user clicks reconnect
      }
    }
    
    // All firmware flashed successfully
    this.log("\n✓ DFU complete! All firmware types flashed successfully.", 'success');
    this.updateProgress(100, 'Installation complete');
    await this.sleep(500);
    
    await this.disconnectPort();
    
    this.renderPage('SUCCESS', {
      message: `Firmware has been successfully installed!<br>${this.firmwareQueue.length} firmware type(s) flashed.`
    });
  }
  
  async reconnectAndContinue() {
    try {
      // Restore state
      if (this.flashState) {
        this.firmwareQueue = this.flashState.firmwareQueue;
        this.currentFirmwareIndex = this.flashState.currentFirmwareIndex || 0;
      }
      
      this.renderPage('INSTALLING', {
        progress: (this.currentFirmwareIndex / this.firmwareQueue.length) * 100,
        label: 'Reconnecting to device',
        details: 'Please select your device again'
      });
      this.log(`=== Reconnecting for firmware part ${this.currentFirmwareIndex + 1}/${this.firmwareQueue.length} ===`, 'info');
      this.log("Please select your device...", 'info');
      
      await this.disconnectPort();
      
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });
      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this.rxBuf = [];
      this.hciSequenceNumber = 0;
      this.readLoop();
      await this.sleep(100);
      
      this.log("✓ Reconnected successfully", 'success');
      
      // Continue flashing remaining firmware
      await this.flashRemainingFirmware();
      
    } catch (e) {
      this.log("Reconnection error: " + e, 'error');
      await this.disconnectPort();
      
      // Check if user cancelled
      if (e instanceof DOMException && e.name === 'NotFoundError') {
        this.renderPage('WAITING_RECONNECT', {
          message: 'Reconnection cancelled',
          details: 'You can try "Reconnect" again, or use "Reset Again" to perform another reset cycle if the device is not responding.'
        });
      } else {
        this.renderPage('ERROR', {
          message: 'Reconnection failed',
          details: e.message + '. You can try "Reconnect" again, or use "Reset Again" to perform another reset cycle.',
          retry: true,
          retryFromReconnect: true
        });
      }
    }
  }
  
  async resetAndReconnect() {
    try {
      // Restore state
      if (this.flashState) {
        this.firmwareQueue = this.flashState.firmwareQueue;
        this.currentFirmwareIndex = this.flashState.currentFirmwareIndex || 0;
      }
      
      this.renderPage('INSTALLING', {
        progress: (this.currentFirmwareIndex / this.firmwareQueue.length) * 100,
        label: 'Resetting device again',
        details: 'Please select your device for reset'
      });
      this.log("=== Resetting device again ===", 'info');
      this.log("Please select your device for reset...", 'info');
      
      await this.disconnectPort();
      
      const resetPort = await navigator.serial.requestPort();
      await resetPort.open({ baudRate: 1200 });
      await resetPort.close();
      this.log("✓ Reset triggered - device entering DFU mode", 'success');
      await this.sleep(500);
      
      // Update state
      this.flashState = {
        firmwareQueue: this.firmwareQueue,
        currentFirmwareIndex: this.currentFirmwareIndex
      };
      
      // Now reconnect and continue
      this.renderPage('INSTALLING', {
        progress: (this.currentFirmwareIndex / this.firmwareQueue.length) * 100,
        label: 'Reconnecting to device',
        details: 'Please select your device again'
      });
      this.log("=== Reconnecting after reset ===", 'info');
      this.log("Please select your device...", 'info');
      
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });
      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this.rxBuf = [];
      this.hciSequenceNumber = 0;
      this.readLoop();
      await this.sleep(100);
      
      this.log("✓ Reconnected successfully", 'success');
      
      // Continue flashing remaining firmware
      await this.flashRemainingFirmware();
      
    } catch (e) {
      this.log("Reset error: " + e, 'error');
      await this.disconnectPort();
      
      if (e instanceof DOMException && e.name === 'NotFoundError') {
        this.renderPage('WAITING_RECONNECT', {
          message: 'Reset cancelled',
          details: 'You can try again, or use "Reconnect" if the device is already in DFU mode.'
        });
      } else {
        this.renderPage('ERROR', {
          message: 'Reset failed',
          details: e.message,
          retry: true,
          retryFromReconnect: true
        });
      }
    }
  }
}

// Immediately make available globally (for regular script tags)
(function() {
  'use strict';
  if (typeof window !== 'undefined') {
    window.NrfWebTools = NrfWebTools;
    // Keep backward compatibility
    window.Nrf52DfuInstaller = NrfWebTools;
  }
  // Export for CommonJS (Node.js)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = NrfWebTools;
  }
})();
