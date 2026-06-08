export function getDailyAuthKey(username: string | undefined | null): string {
    if (!username) return "123456";
    const dateStr = new Date().toISOString().slice(0, 10);
    const seedStr = username.trim().toLowerCase() + dateStr;
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
        hash = (hash << 5) - hash + seedStr.charCodeAt(i);
        hash |= 0;
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    let currentHash = Math.abs(hash);
    
    const salt = [17, 31, 7, 3, 11, 23];
    
    for (let i = 0; i < 6; i++) {
        result += chars[(currentHash + salt[i]) % 36];
        currentHash = Math.floor(currentHash / 36);
        if (currentHash === 0) {
            currentHash = Math.abs(hash) + (i * 13); 
        }
    }
    return result;
}
