/**
 * Messaging Utility Module — Chrome mesajlaşma yardımcıları
 * 
 * Service Worker, Content Script ve Popup arasındaki
 * mesaj tiplerini ve iletişim fonksiyonlarını tanımlar.
 */

export const MSG = {
  // Content Script → Service Worker
  ANALYZE_JOB: 'ANALYZE_JOB',
  CONTENT_READY: 'CONTENT_READY',

  // Service Worker → Content Script
  JOB_ANALYZED: 'JOB_ANALYZED',

  // Popup → Service Worker
  GET_ANALYSIS: 'GET_ANALYSIS',
  GET_HISTORY: 'GET_HISTORY',
  CLEAR_HISTORY: 'CLEAR_HISTORY',
  GET_SETTINGS: 'GET_SETTINGS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  GET_USER_PROFILE: 'GET_USER_PROFILE',
  UPDATE_USER_PROFILE: 'UPDATE_USER_PROFILE',
  REANALYZE_ALL: 'REANALYZE_ALL',
  RUN_AI_ANALYSIS: 'RUN_AI_ANALYSIS'
};

/**
 * Service Worker'a (background) mesaj gönderir.
 * Content Script veya Popup'tan çağrılır.
 * 
 * @param {string} type - Mesaj tipi (MSG sabitlerinden biri)
 * @param {*} [data=null] - Mesajla birlikte gönderilecek veri
 * @returns {Promise<*>} Service Worker'ın döndürdüğü yanıt
 */
export async function sendToBackground(type, data = null) {
  try {
    const response = await chrome.runtime.sendMessage({ type, data });
    return response;
  } catch (error) {
    console.error(`[BidLume] Could not send message to background (${type}):`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Belirli bir sekmeye mesaj gönderir.
 * Service Worker'dan Content Script'e mesaj göndermek için kullanılır.
 * 
 * @param {number} tabId - Hedef sekme ID'si
 * @param {string} type - Mesaj tipi (MSG sabitlerinden biri)
 * @param {*} [data=null] - Mesajla birlikte gönderilecek veri
 * @returns {Promise<*>} Content Script'in döndürdüğü yanıt
 */
export async function sendToTab(tabId, type, data = null) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type, data });
    return response;
  } catch (error) {
    console.error(`[BidLume] Could not send message to tab (tabId: ${tabId}, ${type}):`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Aktif sekmeye mesaj gönderir.
 * Popup'tan Content Script'e erişmek için kolaylık fonksiyonu.
 * 
 * @param {string} type - Mesaj tipi
 * @param {*} [data=null] - Mesaj verisi
 * @returns {Promise<*>}
 */
export async function sendToActiveTab(type, data = null) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('No active tab found');
    }
    return sendToTab(tab.id, type, data);
  } catch (error) {
    console.error(`[BidLume] Could not send message to active tab (${type}):`, error);
    return { success: false, error: error.message };
  }
}
