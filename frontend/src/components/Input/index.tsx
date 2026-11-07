'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

import './input.css';

/**
 * Floating-label input. `.js-focus` on the wrapper is what lifts the label, and
 * it stays on while the field holds a value — the same rule the template used.
 */

export interface InputHandle {
  validate: () => boolean;
  reset: () => void;
  get value(): string;
  get name(): string;
}

export interface InputProps {
  id: string;
  name: string;
  placeholder: string;
  type?: string;
  required?: boolean;
  /** `'email'` turns on the format check. */
  validation?: string;
  validationText?: string;
  className?: string;
  onValue?: (id: string, value: string, hasError: boolean) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const Input = forwardRef<InputHandle, InputProps>(function Input(
  {
    id,
    name,
    placeholder,
    type = 'text',
    required = false,
    validation,
    validationText,
    className,
    onValue,
  },
  ref,
) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const check = (next: string): string | null => {
    if (required && next.trim() === '') return 'required';
    if (next !== '' && validation === 'email' && !EMAIL_RE.test(next)) {
      return validationText ?? 'incorrect email';
    }
    return null;
  };

  useImperativeHandle(ref, () => ({
    validate: () => {
      const message = check(value);
      setError(message);
      return message === null;
    },
    reset: () => {
      setValue('');
      setError(null);
    },
    get value() {
      return value;
    },
    get name() {
      return name;
    },
  }));

  const handleChange = (next: string) => {
    setValue(next);
    if (error) setError(check(next));
    onValue?.(id, next, check(next) !== null);
  };

  const isActive = focused || value !== '';

  return (
    <div className={['input-content', className].filter(Boolean).join(' ')}>
      <div className={['input-wrapper', isActive ? 'js-focus' : ''].filter(Boolean).join(' ')}>
        <input
          ref={inputRef}
          id={id}
          name={name}
          type={type}
          value={value}
          required={required}
          className="input"
          data-validation={required ? 'required' : undefined}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setError(check(value));
          }}
        />
        <label htmlFor={id} className="input-placeholder">
          {placeholder}
          {required ? <abbr title="required"> * </abbr> : null}
        </label>
        {error ? <small className="input-error">{error}</small> : null}
      </div>
    </div>
  );
});

export default Input;
