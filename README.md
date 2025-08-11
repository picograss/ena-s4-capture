# ENA S4 Capture (Playwright)

## 1) Google Apps Script  端：创建 Webhook
在表格的 Apps Script 新建下列代码并部署为“网络应用”（执行者：你自己；访问权限：任何人）。复制得到的 `Web App URL`：

```javascript
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");
    const total = Number(data.totalShards);
    if (!isFinite(total)) {
      return ContentService.createTextOutput("invalid totalShards").setMimeType(ContentService.MimeType.TEXT);
    }
    const now = new Date();
    const ts = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:00");
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("EnaS4Data") || ss.insertSheet("EnaS4Data");
    sheet.appendRow([ts, total]);
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    return ContentService.createTextOutput(String(err)).setMimeType(ContentService.MimeType.TEXT);
  }
}
