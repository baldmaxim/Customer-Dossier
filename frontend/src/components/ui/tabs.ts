// Связь вкладки и панели: id вкладки ↔ aria-labelledby панели, id панели ↔ aria-controls.
// idBase — один на пару Tabs + TabPanel (обычно useId() страницы).

export const tabId = (idBase: string, value: string): string => `${idBase}-tab-${value}`;
export const panelId = (idBase: string, value: string): string => `${idBase}-panel-${value}`;
