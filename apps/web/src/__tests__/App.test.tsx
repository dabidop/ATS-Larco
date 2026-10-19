import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { App } from '../App';

describe('App', () => {
  it('renderiza el título del sistema', () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(screen.getByRole('heading', { name: /ATS LARCO/i })).toBeTruthy();
  });
});
