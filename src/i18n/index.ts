import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import zh from "./locales/zh.json";
import en from "./locales/en.json";
import ja from "./locales/ja.json";

// 从 localStorage 获取保存的语言，否则使用浏览器语言
const savedLanguage = localStorage.getItem("language") || navigator.language.split("-")[0];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
      ja: { translation: ja },
    },
    fallbackLng: "zh",
    lng: savedLanguage,
    interpolation: {
      escapeValue: false, // React 已经处理了 XSS
    },
  });

// 监听语言变化，保存到 localStorage
i18n.on("languageChanged", (lng) => {
  localStorage.setItem("language", lng);
});

export default i18n;
