"use client";
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";
import messages from "@/lib/messages.generated.json";
type Locale = "ko" | "en" | "ja" | "zh";
const LocaleContext = createContext<Locale>("ko");
const dictionary = messages as Record<
  string,
  Record<Exclude<Locale, "ko">, string>
>;
const templates = Object.entries(dictionary)
  .filter(([key]) => /\{\d+\}/.test(key))
  .sort(([a], [b]) => b.length - a.length)
  .map(([key, value]) => {
    const indices: number[] = [];
    const escaped = key
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\{(\d+)\\\}/g, (_, i) => {
        indices.push(Number(i));
        return "(.+?)";
      });
    return { pattern: new RegExp(`^${escaped}$`), indices, value };
  });
export function translateUi(text: string, locale: Locale): string {
  if (locale === "ko") return text;
  const key = text.trim();
  if (dictionary[key]) return text.replace(key, dictionary[key][locale]);
  for (const t of templates) {
    const match = key.match(t.pattern);
    if (match) {
      const translated = t.value[locale].replace(
        /\{(\d+)\}/g,
        (_, i) => match[t.indices.indexOf(Number(i)) + 1] ?? "",
      );
      return text.replace(key, translated);
    }
  }
  return text;
}
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem("nohakwon-locale", locale);
    } catch {}
  }, [locale]);
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}
export function PersistedLocale({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("ko");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("nohakwon-locale");
      if (saved && ["ko", "en", "ja", "zh"].includes(saved))
        setLocale(saved as Locale);
    } catch {}
  }, []);
  return <LocaleProvider locale={locale}>{children}</LocaleProvider>;
}
export function Localize({ children }: { children: ReactNode }) {
  const locale = useContext(LocaleContext);
  function transform(nodes: ReactNode): ReactNode {
    return Children.map(nodes, (node) => {
      if (typeof node === "string") return translateUi(node, locale);
      if (!isValidElement(node)) return node;
      const element = node as ReactElement<Record<string, unknown>>,
        props = element.props;
      if (props["data-localize"] === "off") return node;
      const patch: Record<string, unknown> = {};
      for (const attr of ["title", "placeholder", "aria-label", "alt"])
        if (typeof props[attr] === "string")
          patch[attr] = translateUi(props[attr] as string, locale);
      if (props.children !== undefined)
        patch.children = transform(props.children as ReactNode);
      return cloneElement(element, patch);
    });
  }
  return <>{transform(children)}</>;
}
