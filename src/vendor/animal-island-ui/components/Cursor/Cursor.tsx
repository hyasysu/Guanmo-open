import React from 'react';
import './cursor.css';
// public 目录下的资源通过绝对路径引用，避免 Vite inline 处理在 Tauri WebView 中失效
const cursorIcon = '/cursor-icon.png';

export interface CursorProps {
    /** 子元素 */
    children?: React.ReactNode;
    /** 自定义类名 */
    className?: string;
    /** 自定义样式 */
    style?: React.CSSProperties;
}

export const Cursor: React.FC<CursorProps> = ({ children, className, style }) => {
    return (
        <div
            className={`animal-cursor${className ? ` ${className}` : ''}`}
            style={{
                '--animal-cursor': `url("${cursorIcon}") 4 0, default`,
                ...style,
            } as React.CSSProperties}
        >
            {children}
        </div>
    );
};

Cursor.displayName = 'Cursor';
