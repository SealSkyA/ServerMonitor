package com.servermonitor.app;

import static org.junit.Assert.assertEquals;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Verifies that instrumentation targets the configured Android application.
 */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {

    @Test
    public void targetContextUsesApplicationId() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        assertEquals(BuildConfig.APPLICATION_ID, appContext.getPackageName());
    }
}
