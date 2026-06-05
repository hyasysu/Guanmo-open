import React from 'react';
import styles from './footer.module.css';
import footerSea from '../../assets/img/footer/footer-sea.svg?raw';
import footerTree from '../../assets/img/footer/footer-tree.webp?inline';

export type FooterType = 'sea' | 'tree';

export interface FooterProps {
    /** Footer 类型 */
    type?: FooterType;
    /** 自定义类名 */
    className?: string;
    /** 自定义样式 */
    style?: React.CSSProperties;
}

export const Footer: React.FC<FooterProps> = ({
    type = 'tree',
    className,
    style,
}) => {
    const cls = [styles.footer, styles[type], className].filter(Boolean).join(' ');
    if (type === 'sea') {
        return (
            <div
                className={cls}
                style={style}
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: footerSea }}
            />
        );
    }

    return (
        <div
            className={cls}
            style={{ backgroundImage: `url("${footerTree}")`, ...style }}
            aria-hidden="true"
        />
    );
};

Footer.displayName = 'Footer';
