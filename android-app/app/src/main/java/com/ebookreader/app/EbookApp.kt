package com.ebookreader.app

import android.app.Application
import com.ebookreader.app.data.DownloadManager
import com.ebookreader.app.data.EbookRepository
import com.ebookreader.app.data.LocalBookRepository
import com.ebookreader.app.data.SettingsRepository

class EbookApp : Application() {
    lateinit var settingsRepo: SettingsRepository
    lateinit var ebookRepo: EbookRepository
    lateinit var localBookRepo: LocalBookRepository
    lateinit var downloadManager: DownloadManager

    override fun onCreate() {
        super.onCreate()
        settingsRepo = SettingsRepository(this)
        ebookRepo = EbookRepository(this, settingsRepo)
        localBookRepo = LocalBookRepository(this)
        downloadManager = DownloadManager(this, ebookRepo, localBookRepo)
    }
}
