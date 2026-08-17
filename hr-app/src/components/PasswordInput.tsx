import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Extra classes for the toggle button, e.g. hover colours on dark surfaces. */
  toggleClassName?: string
}

/**
 * Password field with a show/hide toggle. Drop-in replacement for a plain
 * `<input type="password">`: the caller's `className` still styles the input,
 * and right padding is reserved so text never runs under the eye button.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className = '', toggleClassName = '', ...props }, ref) {
    const [visible, setVisible] = useState(false)
    return (
      <div className="relative">
        <input
          {...props}
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={`${className} pr-11`}
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          className={`absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 transition-colors hover:text-slate-600 ${toggleClassName}`}
          aria-label={visible ? 'Hide password' : 'Show password'}
          title={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    )
  },
)
