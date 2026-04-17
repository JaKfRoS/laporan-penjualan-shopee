
import React from 'react';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {children}
    </div>
  );
};
