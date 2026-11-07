'use client';

import { useRef, useState, type FormEvent } from 'react';

import Button from '@/components/Button';
import Input, { type InputHandle } from '@/components/Input';
import LetterCanvas from '@/components/LetterCanvas';
import { Logo } from '@/components/icons';
import { FOOTER_CONTACTS, FOOTER_LEGAL } from '@/data/content';
import { useUi } from '@/store/ui';

import './footer.css';

/**
 * Footer: the physics letter canvas on top, then contacts, the beta signup and
 * the legal row.
 */
export default function Footer() {
  const { addToast, setWaiting } = useUi();
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<InputHandle>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!emailRef.current?.validate()) return;

    setSubmitting(true);
    setWaiting(true);

    try {
      // The template posted to an endpoint that is not part of the scrape, so
      // the submit is acknowledged locally through the toast stack.
      await new Promise((resolve) => setTimeout(resolve, 400));
      addToast('Thanks! You are on the beta list.', 'success');
      emailRef.current?.reset();
    } catch {
      addToast('Something went wrong. Please try again.', 'danger');
    } finally {
      setSubmitting(false);
      setWaiting(false);
    }
  };

  return (
    <footer className="footer">
      <div className="container footer__container">
        <div className="footer__top">
          <LetterCanvas />
        </div>

        <div className="footer__bottom">
          <div className="footer__line" />

          <div className="grid footer__content">
            <div className="footer__item foter__item--1">
              <Logo />
            </div>

            <div className="footer__item foter__item--2">
              <h3 className="footer__h">Contact us</h3>
              <ul className="footer__contacts">
                {FOOTER_CONTACTS.map((contact) => (
                  <li className="footer__contact footer-contact" key={contact.text}>
                    <Button
                      tag="a"
                      className="footer-contact__btn"
                      href={contact.link}
                      target="_blank"
                      rel="noreferrer noopener"
                      text={contact.text}
                    />
                  </li>
                ))}
              </ul>
            </div>

            <div className="footer__item foter__item--4">
              <h3 className="footer__h">Join the beta</h3>
              <form className="form footer__form" noValidate onSubmit={onSubmit}>
                <Input
                  ref={emailRef}
                  id="email"
                  name="Email"
                  placeholder="Your Email"
                  type="email"
                  required
                  validation="email"
                  validationText="incorrect email"
                  className="form__input"
                />
                <Button type="submit" className="form__btn input-btn" text="Join" />
              </form>
            </div>
          </div>
        </div>

        <div className="footer__info">
          <div className="grid footer__info-content">
            <div className="footer__item foter__item--1">
              <small className="footer__copy">{FOOTER_LEGAL.copy}</small>
            </div>
            <div className="footer__item foter__item--2">
              <a
                className="footer__legal"
                href={FOOTER_LEGAL.terms.href}
                target="_blank"
                rel="noreferrer noopener"
              >
                {FOOTER_LEGAL.terms.label}
              </a>
            </div>
            <div className="footer__item foter__item--3">
              <a
                className="footer__legal"
                href={FOOTER_LEGAL.privacy.href}
                target="_blank"
                rel="noreferrer noopener"
              >
                {FOOTER_LEGAL.privacy.label}
              </a>
            </div>
            <div className="footer__item foter__item--4">
              <a
                href={FOOTER_LEGAL.by.href}
                target="_blank"
                rel="noreferrer noopener"
                className="footer__by"
              >
                {FOOTER_LEGAL.by.label}
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
