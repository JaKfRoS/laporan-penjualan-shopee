
import React from 'react';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="p-4 sm:p-8 lg:p-12 max-w-7xl mx-auto">
      {children}
    </div>
  );
};
