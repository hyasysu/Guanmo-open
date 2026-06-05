import React from 'react';
import styles from './icon.module.css';
import iconCamera from '../../assets/img/icons/icon-camera.svg?raw';
import iconChat from '../../assets/img/icons/icon-chat.svg?raw';
import iconCritterpedia from '../../assets/img/icons/icon-critterpedia.svg?raw';
import iconDesign from '../../assets/img/icons/icon-design.svg?raw';
import iconDiy from '../../assets/img/icons/icon-diy.svg?raw';
import iconHelicopter from '../../assets/img/icons/icon-helicopter.svg?raw';
import iconMap from '../../assets/img/icons/icon-map.svg?raw';
import iconMiles from '../../assets/img/icons/icon-miles.svg?raw';
import iconShopping from '../../assets/img/icons/icon-shopping.svg?raw';
import iconVariant from '../../assets/img/icons/icon-variant.svg?raw';

export type IconName =
    | 'icon-miles'
    | 'icon-camera'
    | 'icon-chat'
    | 'icon-critterpedia'
    | 'icon-design'
    | 'icon-diy'
    | 'icon-helicopter'
    | 'icon-map'
    | 'icon-shopping'
    | 'icon-variant';

export interface IconProps {
    name: IconName;
    size?: number | string;
    className?: string;
    style?: React.CSSProperties;
    bounce?: boolean;
}

const iconSvgMap: Record<IconName, string> = {
    'icon-miles': iconMiles,
    'icon-camera': iconCamera,
    'icon-chat': iconChat,
    'icon-critterpedia': iconCritterpedia,
    'icon-design': iconDesign,
    'icon-diy': iconDiy,
    'icon-helicopter': iconHelicopter,
    'icon-map': iconMap,
    'icon-shopping': iconShopping,
    'icon-variant': iconVariant,
};

export const Icon: React.FC<IconProps> = ({
    name,
    size = 24,
    className,
    style,
    bounce = false,
    ...rest
}) => {
    // 使用 key 来强制重新触发动画
    const [animKey, setAnimKey] = React.useState(0)

    React.useEffect(() => {
        if (bounce) {
            setAnimKey(prev => prev + 1)
        }
    }, [bounce])

    return (
        <span
            key={bounce ? `bounce-${animKey}` : 'static'}
            className={`${styles.icon} ${bounce ? styles.iconBounce : ''} ${className || ''}`}
            style={{
                width: size,
                height: size,
                ...style,
            }}
            {...rest}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: iconSvgMap[name] }}
        />
    );
};

export const ICON_LIST: { name: IconName; label: string }[] = [
    { name: 'icon-miles', label: 'NookMiles' },
    { name: 'icon-camera', label: 'Camera' },
    { name: 'icon-chat', label: 'Chat' },
    { name: 'icon-critterpedia', label: 'Critterpedia' },
    { name: 'icon-design', label: 'Design' },
    { name: 'icon-diy', label: 'DIY' },
    { name: 'icon-helicopter', label: 'Helicopter' },
    { name: 'icon-map', label: 'Map' },
    { name: 'icon-shopping', label: 'Shopping' },
    { name: 'icon-variant', label: 'Variant' },
];
