'use client';

import { useRef, useState, type FormEvent } from 'react';

import Button from '@/components/Button';
import Input, { type InputHandle } from '@/components/Input';
import Popup from '@/components/Popup';
import { useUi } from '@/store/ui';

/**
 * The `.new-form` popup: the "Join the beta" dialog with Name + Email, wired to
 * the same two fields the template declared.
 */
export default function JoinBetaForm() {
  const { isPopupOpened, closePopup, addToast, setWaiting } = useUi();
  const [submitting, setSubmitting] = useState(false);

  const nameRef = useRef<InputHandle>(null);
  const emailRef = useRef<InputHandle>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const fields = [nameRef.current, emailRef.current];
    const valid = fields.every((field) => field?.validate() ?? true);
    if (!valid) return;

    setSubmitting(true);
    setWaiting(true);

    try {
      // No endpoint shipped with the template; the submit is accepted locally
      // and reported through the toast stack, as the original did on success.
      await new Promise((resolve) => setTimeout(resolve, 400));
      addToast('Thanks! You are on the beta list.', 'success');
      for (const field of fields) field?.reset();
      closePopup();
    } catch {
      addToast('Something went wrong. Please try again.', 'danger');
    } finally {
      setSubmitting(false);
      setWaiting(false);
    }
  };

  return (
    <div className="new-form">
      <Popup isOpen={isPopupOpened} onClose={closePopup}>
        <form className="form popup__form" noValidate onSubmit={onSubmit}>
          <legend className="popup__form-h">Join the beta</legend>
          <Input
            ref={nameRef}
            id="name"
            name="Name"
            placeholder="Your Name"
            type="text"
            className="form__input popup__form-input"
          />
          <Input
            ref={emailRef}
            id="email-2"
            name="Email"
            placeholder="Your Email"
            type="email"
            required
            validation="email"
            validationText="incorrect email"
            className="form__input popup__form-input"
          />
          <Button type="submit" className="popup__form-btn" text="Join" />
        </form>
      </Popup>
    </div>
  );
}
