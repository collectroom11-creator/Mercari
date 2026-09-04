const { app, BrowserWindow } = require("electron");

function createMainWindow() {
  const win = new BrowserWindow({ width: 900, height: 700 });
  win.loadFile("index.html");
}

app.whenReady().then(createMainWindow);
app.on("window-all-closed", () => app.quit());
