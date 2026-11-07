"use client";

import { useLocale } from "../i18n/command-locale";
import { salesCopy, type SalesCopy } from "./copy";

/**
 * The sales copy for the ACTIVE locale.
 *
 * One line, on purpose: the language has exactly one source (`useLocale`, the
 * provider the `/command` layout seeds from the locale cookie), and this hook
 * only asks that source which dictionary to read. Switching the language cannot
 * leave the gateway and the room disagreeing, because neither owns a locale.
 */
export function useSalesCopy(): SalesCopy {
  const { locale } = useLocale();
  return salesCopy(locale);
}
