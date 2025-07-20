import { getCurrentWindow } from '@tauri-apps/api/window';


export default function Titlebar() {
    const appWindow = getCurrentWindow();

    return (<div data-tauri-drag-region class="titlebar">

        <button onClick={() => appWindow.minimize()} class="titlebar-button" id="titlebar-minimize">
            <img src="https://api.iconify.design/mdi:window-minimize.svg" alt="minimize" />
        </button>

        <button onClick={() => appWindow.toggleMaximize()} class="titlebar-button" id="titlebar-maximize">
            <img src="https://api.iconify.design/mdi:window-maximize.svg" alt="maximize" />
        </button>

        <button onClick={() => appWindow.close()} class="titlebar-button" id="titlebar-close">
            <img src="https://api.iconify.design/mdi:close.svg" alt="close" />
        </button>

    </div>);
}
