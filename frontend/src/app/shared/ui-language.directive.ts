import {
  AfterViewInit,
  Directive,
  ElementRef,
  OnDestroy,
  effect,
  inject,
} from '@angular/core';
import { LanguageService } from '../core/language.service';

@Directive({
  selector: '[appUiLanguage]',
  standalone: true,
})
export class UiLanguageDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly language = inject(LanguageService);
  private readonly textSources = new WeakMap<Text, string>();
  private readonly attributeSources = new WeakMap<Element, Map<string, string>>();
  private readonly translatableAttributes = ['placeholder', 'title', 'aria-label'] as const;
  private observer?: MutationObserver;
  private initialized = false;
  private scheduled = false;

  private readonly languageEffect = effect(() => {
    this.language.language();
    if (this.initialized) this.scheduleTranslation();
  });

  ngAfterViewInit() {
    this.initialized = true;
    this.translateTree(this.host);
    this.observer = new MutationObserver(records => this.handleMutations(records));
    this.observe();
  }

  ngOnDestroy() {
    this.languageEffect.destroy();
    this.observer?.disconnect();
  }

  private observe() {
    this.observer?.observe(this.host, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...this.translatableAttributes],
    });
  }

  private handleMutations(records: MutationRecord[]) {
    this.observer?.disconnect();
    for (const record of records) {
      if (record.type === 'characterData' && record.target.nodeType === Node.TEXT_NODE) {
        const text = record.target as Text;
        this.textSources.set(text, text.data);
      } else if (record.type === 'attributes' && record.target.nodeType === Node.ELEMENT_NODE && record.attributeName) {
        const element = record.target as Element;
        const value = element.getAttribute(record.attributeName);
        if (value != null) this.attributeMap(element).set(record.attributeName, value);
      }
    }
    this.translateTree(this.host);
    this.observe();
  }

  private scheduleTranslation() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.initialized) return;
      this.observer?.disconnect();
      this.translateTree(this.host);
      this.observe();
    });
  }

  private translateTree(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      this.translateText(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as Element;
    if (element.matches('script, style, code, pre')) return;
    this.translateAttributes(element);
    for (const child of Array.from(element.childNodes)) this.translateTree(child);
  }

  private translateText(node: Text) {
    const source = this.textSources.get(node) ?? node.data;
    if (!this.textSources.has(node)) this.textSources.set(node, source);
    const translated = this.language.translate(source);
    if (node.data !== translated) node.data = translated;
  }

  private translateAttributes(element: Element) {
    const sources = this.attributeMap(element);
    for (const attribute of this.translatableAttributes) {
      const current = element.getAttribute(attribute);
      if (current == null) continue;
      if (!sources.has(attribute)) sources.set(attribute, current);
      const translated = this.language.translate(sources.get(attribute) ?? current);
      if (current !== translated) element.setAttribute(attribute, translated);
    }
  }

  private attributeMap(element: Element) {
    let map = this.attributeSources.get(element);
    if (!map) {
      map = new Map<string, string>();
      this.attributeSources.set(element, map);
    }
    return map;
  }
}
