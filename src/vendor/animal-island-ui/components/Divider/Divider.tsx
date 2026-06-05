import React from 'react';
import styles from './divider.module.css';
import lineBrown from '../../assets/img/dividers/divider-line-brown.svg?raw';
import lineTeal from '../../assets/img/dividers/divider-line-teal.svg?raw';
import lineWhite from '../../assets/img/dividers/divider-line-white.png?inline';
import lineYellow from '../../assets/img/dividers/divider-line-yellow.svg?raw';
import waveYellow from '../../assets/img/dividers/wave-yellow.svg?raw';

export type DividerType = 'line-brown' | 'line-teal' | 'line-white' | 'line-yellow' | 'wave-yellow';

export interface DividerProps {
    /** 分隔线类型 */
    type?: DividerType;
    /** 自定义类名 */
    className?: string;
    /** 自定义样式 */
    style?: React.CSSProperties;
}

const dividerClassMap: Record<DividerType, string | undefined> = {
    'line-brown': undefined,
    'line-teal': styles.lineTeal,
    'line-white': styles.lineWhite,
    'line-yellow': styles.lineYellow,
    'wave-yellow': styles.waveYellow,
};

const dividerSvgMap: Record<Exclude<DividerType, 'line-white'>, string> = {
    'line-brown': lineBrown,
    'line-teal': lineTeal,
    'line-yellow': lineYellow,
    'wave-yellow': waveYellow,
};

export const Divider: React.FC<DividerProps> = ({ type = 'line-brown', className, style }) => {
    const cls = [styles.divider, dividerClassMap[type], className].filter(Boolean).join(' ');
    if (type === 'line-white') {
        return (
            <div
                className={cls}
                style={{ backgroundImage: `url("${lineWhite}")`, ...style }}
                aria-hidden="true"
            />
        );
    }

    return (
        <div
            className={cls}
            style={style}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: dividerSvgMap[type] }}
        />
    );
};

Divider.displayName = 'Divider';
