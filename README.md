# nRF Web Tools

User-friendly tool to manage nRF52 devices with the Adafruit nRF bootloader directly in your web browser. No drivers or desktop software required!

## Features

- **Easy Installation** - Install & update firmware with a single click
- **Universal Support** - Works with all devices using the Adafruit nRF bootloader
- **Cross-Platform** - Works on desktop (Chrome/Edge) and Android (via WebUSB polyfill)
- **No Installation Required** - Runs entirely in the browser using Web Serial API
- **DFU Package Support** - Handles complete DFU packages with multiple firmware types (application, bootloader, softdevice)

## Browser Support

-  **Google Chrome**
-  **Microsoft Edge**
-  **Android** (via Web Serial Polyfill)

## Quick Start

#### Basic Integration

Add nRF Web Tools to your website with just a few lines of code:

```html
<!-- Include required libraries -->
<script src="https://opendisplay.org/nrf_web_tools/jszip.min.js"></script>

<!-- Web Serial Polyfill for Android support (optional) -->
<script type="module">
  import { serial } from 'https://opendisplay.org/nrf_web_tools/web-serial-polyfill.js';
  const isAndroid = /Android/i.test(navigator.userAgent);
  if (isAndroid && navigator.usb) {
    navigator.serial = serial;
  } else if (!navigator.serial) {
    navigator.serial = serial;
  }
</script>

<script src="https://opendisplay.org/nrf_web_tools/nrf_web_tools.js"></script>

<!-- Your button -->
<button id="install-btn">Install Firmware</button>

<script>
  window.addEventListener('load', () => {
    const installer = new NrfWebTools(
      document.getElementById('install-btn'),
      'https://example.com/firmware.zip'  // URL to your DFU package
    );
  });
</script>
```

#### Advanced Integration

For more control, you can manually trigger installation and handle events:

```javascript
const installer = new NrfWebTools(
  document.getElementById('install-btn'),
  'https://example.com/firmware.zip'
);

// Manually start installation
installer.startInstall();

// Close the modal programmatically
installer.closeModal();
```

## API Reference

### Constructor

```javascript
new NrfWebTools(buttonElement, zipPath)
```

**Parameters:**
- `buttonElement` (HTMLElement) - The button element to attach the installer to
- `zipPath` (string | File) - URL string or File object pointing to the DFU package ZIP file

### Methods

- `startInstall()` - Manually trigger the installation (usually called automatically on button click)
- `closeModal()` - Close the progress modal

## DFU Package Format

nRF Web Tools expects DFU packages in ZIP format containing:

- `manifest.json` - Package metadata describing firmware components
- Firmware `.bin` files - Binary firmware files
- Init packet `.dat` files - Initialization packets for each firmware

The tool automatically detects and installs:
- Application firmware
- Bootloader firmware
- Softdevice firmware
- Combined Softdevice + Bootloader firmware

All firmware types are installed in the correct order automatically.

## How It Works

nRF Web Tools uses:

1. **Web Serial API** - For direct serial communication with devices
2. **Web Serial Polyfill** - Implements Web Serial on top of WebUSB for Android support
3. **DFU Protocol** - Nordic's Device Firmware Update protocol over serial
4. **SLIP Framing** - Serial Line Internet Protocol for packet framing
5. **HCI Packets** - Custom packet structure with CRC16 checksums and ACK-based reliable transmission

The installation process:

1. **1200-baud Reset** - Puts the device into bootloader mode
2. **115200-baud Connection** - Establishes high-speed connection for flashing
3. **Firmware Detection** - Reads manifest.json to identify available firmware types
4. **Sequential Installation** - Installs firmware in the correct order (SD+BL, then SD, then BL, then APP)
5. **Progress Tracking** - Real-time progress updates with detailed status messages

## Requirements

- Website must be served over `https://` (Web Serial security requirement)
- `localhost` is also allowed for local development
- Device must have the Adafruit nRF bootloader installed

## Installation Process

The tool uses a two-step device selection process:

1. **First Selection** - Select your device for the 1200-baud reset (puts device in bootloader mode)
2. **Second Selection** - After the device resets, select it again for the 115200-baud flashing connection

This is required due to browser security restrictions that require user interaction for each port selection.

## Related Projects

- [OpenDisplay](https://opendisplay.org) - E-paper display project using nRF Web Tools
- [Adafruit nRF Bootloader](https://github.com/adafruit/Adafruit_nRF52_Bootloader) - Bootloader used by supported devices
- [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) - Browser API for serial communication
- [Web Serial Polyfill](https://github.com/google/web-serial-polyfill) - Polyfill for Android support

## Acknowledgments

- Based on Nordic Semiconductor's DFU protocol
- Uses [JSZip](https://stuk.github.io/jszip/) for ZIP file handling
- Uses [Web Serial Polyfill](https://github.com/google/web-serial-polyfill) for Android support
- Inspired by [ESP Web Tools](https://esphome.github.io/esp-web-tools/)
